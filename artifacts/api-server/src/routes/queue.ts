import { Router } from "express";
import { db, queueItemsTable } from "@workspace/db";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireUserId } from "../middlewares/auth";
import { describeDbError } from "../lib/dbErrors";
import { isUserFacingError, messageForCaller } from "../lib/userFacingError";
import { performQueueItemSendAction } from "../lib/connectors/sendAction";
import { countUnseen, markQueueSeen } from "../lib/dailyDigest";
import { getNudgesFor, markNudgesShown } from "../lib/nudges";
import { logger } from "../lib/logger";

const router = Router();

// Command Center's queue backer. Every row here is something Vera already
// drafted/decided/found — this is deliberately never a "create" endpoint for
// the founder; items only ever arrive via connectors/workflows/decision
// follow-ups (later phases) or, for now, the first-run demo seed below.
// The board starts EMPTY apart from this one item. It previously seeded
// three fabricated entries — a drafted reply to "Priya (Northwind Retail)",
// a flat-MRR reading off a revenue sheet, a suggestion to automate a report
// the founder had supposedly run twice — none of which referred to anything
// real. Every one of them described work Vera had not done, sourced from
// accounts that were not connected, so the founder's first impression of
// the product was three pieces of fiction they had to clear by hand. What
// lands here from now on is only ever something Vera actually did for THIS
// founder, via a connector poll, a workflow run, or a decision follow-up.
//
// The single exception is this welcome item: it makes no claim about work
// performed, it just points at the one setup step that makes everything
// else start arriving. `source: "vera"` is what the frontend keys off to
// route its action at Workflows instead of treating it as a draft to send.
const WELCOME_ITEM = {
  type: "welcome",
  source: "vera",
  title: "Welcome to Asher — your personalized business consultant",
  body: "This board is where everything Asher drafts, decides, or finds for you shows up. It's quiet right now because nothing is connected yet — set up your first workflow and Asher starts filling it in on its own.",
  draftContent: null,
  externalId: "welcome",
};

// Titles of the three fabricated rows the old seeder wrote. Accounts
// created before this change still hold them, and dropping the seeder does
// nothing about rows already in the table — so they're cleared here.
// Matched on exact title AND the exact source the seeder paired it with,
// which no genuine connector row can collide with (a real Gmail item's
// title is built from the actual thread's subject).
const RETIRED_DEMO_ROWS: { title: string; source: string }[] = [
  { title: "Reply drafted for Priya (Northwind Retail)", source: "gmail" },
  { title: "Weekly revenue sheet: 3rd week of flat MRR", source: "connector:sheets" },
  { title: "Automate: weekly report from Sheets", source: "workflow" },
];

async function purgeRetiredDemoRows(userId: string) {
  await db.delete(queueItemsTable).where(
    and(
      eq(queueItemsTable.userId, userId),
      or(...RETIRED_DEMO_ROWS.map((r) => and(eq(queueItemsTable.title, r.title), eq(queueItemsTable.source, r.source)))),
    ),
  );
}

// Runs once per founder, keyed on "has this user ever had a queue row",
// so clearing the welcome item doesn't bring it back on the next load.
async function ensureWelcomeItem(userId: string) {
  const [existing] = await db.select({ id: queueItemsTable.id }).from(queueItemsTable).where(eq(queueItemsTable.userId, userId)).limit(1);
  if (existing) return;
  await db.insert(queueItemsTable).values({ userId, ...WELCOME_ITEM }).onConflictDoNothing();
}

// GET /queue — pending items first (oldest first, so the founder clears the
// queue in the order things came in), then resolved items most-recent-first
// as a short history underneath. Capped at 50: this is a daily workspace,
// not an archive browser.
/* ---- Nudges become REAL BOARD ITEMS, at most one every three hours ----
 *
 * THE BUG THIS FIXES. Nudges used to render as a separate strip above the board
 * and were added into the sidebar's unread badge. So the badge could read "1"
 * while the board itself said "Nothing waiting on you" — two different concepts
 * sharing one number, and the founder reasonably read the dot as a permanent
 * decoration that meant nothing. Reported as exactly that.
 *
 * The dot now means one thing only: there are unseen items ON THIS BOARD. For
 * that to stay true while still prompting people, the prompt has to BE a board
 * item. So the most important unfinished thing gets written into queue_items
 * like anything else Vera surfaces — it lights the dot because it is genuinely
 * there, it can be acted on or rejected, and clearing the board clears the dot.
 *
 * CADENCE WITHOUT A CRON. Checked lazily on board load rather than by a
 * scheduler, the same way ensureWelcomeItem works. nudge_state.lastShownAt is
 * the rate limiter — getNudgesFor already refuses to return a kind inside its
 * three-hour cooldown, so calling this on every load cannot produce more than
 * one item per kind per three hours. No new infrastructure, and it cannot drift
 * out of sync with the cooldown because it IS the cooldown.
 *
 * ONE AT A TIME, deliberately. Writing every outstanding nudge at once would
 * put four items on a board that had none and read as spam. The engine already
 * returns them ordered by priority, so the first is the one worth interrupting
 * for.
 *
 * Best-effort throughout: a failure here must never cost the founder the board
 * itself, which is the thing they actually came for.
 */
async function ensureNudgeItems(userId: string): Promise<void> {
  try {
    const nudges = await getNudgesFor(userId, new Date(), 1);
    const top = nudges[0];
    if (!top) return;

    // externalId is what stops a restart or a second tab creating a duplicate:
    // the same nudge kind on the same day resolves to the same row.
    const externalId = `nudge:${top.kind}:${new Date().toISOString().slice(0, 10)}`;

    const [existing] = await db
      .select({ id: queueItemsTable.id })
      .from(queueItemsTable)
      .where(and(eq(queueItemsTable.userId, userId), eq(queueItemsTable.externalId, externalId)))
      .limit(1);
    if (existing) return;

    await db
      .insert(queueItemsTable)
      .values({
        userId,
        type: "nudge",
        source: "vera",
        title: top.title,
        body: top.body,
        draftContent: null,
        externalId,
      })
      .onConflictDoNothing();

    // Recorded as shown only once the row is actually written, so the cooldown
    // starts when the founder can genuinely see it — not when it was computed.
    await markNudgesShown(userId, [top.kind]);
  } catch (err) {
    req_log_safe(err);
  }
}

// The board must load even if nudging fails. Kept as a named helper so the
// swallow is deliberate and greppable rather than a bare empty catch.
function req_log_safe(err: unknown): void {
  logger.error({ err }, "Could not materialise a nudge onto the board");
}

router.get("/queue", requireAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    await purgeRetiredDemoRows(userId);
    await ensureWelcomeItem(userId);
    await ensureNudgeItems(userId);

    const rows = await db
      .select()
      .from(queueItemsTable)
      .where(eq(queueItemsTable.userId, userId))
      .orderBy(sql`case when ${queueItemsTable.status} = 'pending' then 0 else 1 end`, desc(queueItemsTable.createdAt))
      .limit(50);

    // The notification dot's number. Counted server-side rather than derived
    // from `rows` because the list is capped at 50 — deriving it would silently
    // under-report the moment a founder had more than fifty items, which is
    // exactly when the dot matters most.
    return res.json({ items: rows, unseen: await countUnseen(userId) });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to load queue" });
  }
});

const ActionBody = z.object({
  action: z.enum(["accept", "edit", "reject"]),
  edited_content: z.string().optional(),
});

router.post("/queue/:id/action", requireAuth, async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: "Invalid queue item id" });

  const body = ActionBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "action must be accept, edit, or reject" });
  if (body.data.action === "edit" && !body.data.edited_content?.trim()) {
    return res.status(400).json({ error: "edited_content is required for an edit action" });
  }

  try {
    const userId = requireUserId(req);
    const [owned] = await db
      .select()
      .from(queueItemsTable)
      .where(and(eq(queueItemsTable.id, itemId), eq(queueItemsTable.userId, userId)))
      .limit(1);
    if (!owned) return res.status(404).json({ error: "Queue item not found" });
    if (owned.status !== "pending") return res.status(400).json({ error: "Queue item already resolved" });

    const status = body.data.action === "accept" ? "accepted" : body.data.action === "reject" ? "rejected" : "edited";
    const finalDraftContent = body.data.action === "edit" ? body.data.edited_content! : owned.draftContent;

    // Accept/edit is the moment a queue item stops being "a suggestion in
    // our DB" and becomes a real action (a Gmail draft saved, a Slack reply
    // sent, a LinkedIn post published) — done BEFORE marking the row
    // resolved, so a failed send leaves the item pending for retry instead
    // of silently reporting success while nothing actually happened.
    if (status === "accepted" || status === "edited") {
      await performQueueItemSendAction(userId, { ...owned, draftContent: finalDraftContent });
    }

    const [updated] = await db
      .update(queueItemsTable)
      .set({
        status,
        resolvedAt: new Date(),
        ...(body.data.action === "edit" ? { draftContent: body.data.edited_content } : {}),
      })
      // userId is repeated here even though the SELECT above already proved
      // ownership of this row. A write that carries its own ownership
      // condition cannot be detached from the check that authorises it — the
      // previous version was correct only for as long as nobody reordered,
      // extracted or early-returned around that read.
      .where(and(eq(queueItemsTable.id, itemId), eq(queueItemsTable.userId, userId)))
      .returning();

    return res.json({ item: updated });
  } catch (err) {
    req.log.error(err);
    // performQueueItemSendAction throws UserFacingError for the reasons a
    // founder can act on ("slack isn't connected", "this draft is missing its
    // routing details"). Those are the whole value of the message here, since
    // the item stays pending and they can retry after fixing it. Anything else
    // is answered generically.
    const status = isUserFacingError(err) ? err.status : 500;
    return res.status(status).json({ error: messageForCaller(err, describeDbError(err)) });
  }
});

/* ---- Clearing the notification dot ----
 *
 * Separate from GET /queue on purpose. If reading the board marked everything
 * seen as a side effect, the dot would clear on any background refetch —
 * TanStack Query refetches on window focus, so simply alt-tabbing back to a
 * tab left open on another page would silently mark a founder's items read
 * without them ever being on screen. That is the failure mode that makes a
 * notification dot untrustworthy, and once it is untrustworthy it is ignored.
 *
 * So the client calls this deliberately, when the board is actually shown.
 */
router.post("/queue/seen", requireAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const marked = await markQueueSeen(userId);
    return res.json({ marked, unseen: await countUnseen(userId) });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: describeDbError(err) });
  }
});

export default router;
