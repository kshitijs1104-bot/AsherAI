import { Router } from "express";
import { db, queueItemsTable } from "@workspace/db";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireUserId } from "../middlewares/auth";
import { describeDbError } from "../lib/dbErrors";
import { isUserFacingError, messageForCaller } from "../lib/userFacingError";
import { performQueueItemSendAction } from "../lib/connectors/sendAction";

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
  title: "Welcome to Vera — your personalized business consultant",
  body: "This board is where everything Vera drafts, decides, or finds for you shows up. It's quiet right now because nothing is connected yet — set up your first workflow and Vera starts filling it in on its own.",
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
router.get("/queue", requireAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    await purgeRetiredDemoRows(userId);
    await ensureWelcomeItem(userId);

    const rows = await db
      .select()
      .from(queueItemsTable)
      .where(eq(queueItemsTable.userId, userId))
      .orderBy(sql`case when ${queueItemsTable.status} = 'pending' then 0 else 1 end`, desc(queueItemsTable.createdAt))
      .limit(50);

    return res.json({ items: rows });
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

export default router;
