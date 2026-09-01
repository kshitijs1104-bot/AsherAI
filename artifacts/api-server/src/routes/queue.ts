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
import { getGroqClient } from "../lib/groq";
import { executeQueueResolveTool, QUEUE_RESOLVE_TOOLS } from "../lib/queueResolveTools";

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
  action: z.enum(["accept", "edit", "reject", "dismiss"]),
  edited_content: z.string().optional(),
});

router.post("/queue/:id/action", requireAuth, async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: "Invalid queue item id" });

  const body = ActionBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "action must be accept, edit, reject, or dismiss" });
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

    // Drafts are now resolved only through the scoped, confirm-first AI flow.
    // Keeping this guard prevents the legacy Accept path from sending beside
    // the new confirmation step.
    if ((body.data.action === "accept" || body.data.action === "edit") && owned.type === "draft_reply") {
      return res.status(409).json({ error: "Draft replies must be resolved through the confirmed Asher flow" });
    }

    const status = body.data.action === "accept" ? "accepted" : body.data.action === "reject" ? "rejected" : body.data.action === "dismiss" ? "dismissed" : "edited";
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

const ResolveMessageBody = z.object({
  message: z.string().trim().min(1).max(20000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20000) })).max(20).default([]),
});

// Only types with a real backing mutation are eligible for Asher resolution.
// Poll/read-only types must produce an explicit limitation, never a guessed
// connector action or a silent no-op.
const RESOLVABLE_TYPES = new Set(["draft_reply", "goal_risk", "nudge"]);

const NUDGE_KIND_TOOL_ALLOWLIST: Record<string, readonly string[]> = {
  "onboarding.incomplete": ["update_profile_field"],
  "dossier.missing": ["update_profile_field"],
  "dossier.incomplete": ["update_profile_field"],
  "goal.none": ["update_goal_status"],
};

function nudgeKindFor(item: { externalId?: string | null }) {
  const match = /^nudge:([^:]+):/.exec(item.externalId ?? "");
  return match?.[1] ?? null;
}

function allowedQueueResolveToolsForItem(item: { type: string; externalId?: string | null }) {
  if (item.type !== "nudge") return QUEUE_RESOLVE_TOOLS;

  const kind = nudgeKindFor(item);
  const allowed = kind ? (NUDGE_KIND_TOOL_ALLOWLIST[kind] ?? []) : [];
  if (allowed.length === 0) return [];
  return QUEUE_RESOLVE_TOOLS.filter((tool) => allowed.includes(tool.function.name));
}

async function loadOwnedQueueItem(userId: string, itemId: number) {
  const [item] = await db.select().from(queueItemsTable).where(and(eq(queueItemsTable.id, itemId), eq(queueItemsTable.userId, userId))).limit(1);
  return item;
}

router.post("/queue/:id/resolve/message", requireAuth, async (req, res) => {
  const itemId = Number(req.params.id);
  const body = ResolveMessageBody.safeParse(req.body);
  if (!Number.isFinite(itemId) || !body.success) return res.status(400).json({ error: "A queue item id and non-empty message are required" });

  try {
    const userId = requireUserId(req);
    const item = await loadOwnedQueueItem(userId, itemId);
    if (!item) return res.status(404).json({ error: "Queue item not found" });
    if (item.status !== "pending") return res.status(400).json({ error: "Queue item already resolved" });
    if (!RESOLVABLE_TYPES.has(item.type)) return res.json({ assistant: "Asher can't automate this type yet.", proposal: null, unavailable: true });

    const allowedTools = item.type === "nudge" ? allowedQueueResolveToolsForItem(item) : QUEUE_RESOLVE_TOOLS;
    if (item.type === "nudge" && allowedTools.length === 0) {
      return res.json({ assistant: "Asher can't automate this nudge yet.", proposal: null, unavailable: true });
    }

    const groq = getGroqClient();
    if (!groq) return res.status(503).json({ error: "Asher is not configured" });
    const context = `Queue item id: ${item.id}\nType: ${item.type}\nSource: ${item.source}\nTitle: ${item.title}\nBody: ${item.body}\nDraft: ${item.draftContent ?? "none"}\nMetadata: ${item.metadataJson ?? "none"}\nNudge kind: ${nudgeKindFor(item) ?? "unknown"}`;
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      temperature: 0.2,
      max_tokens: 1200,
      messages: [
        { role: "system", content: `You are resolving exactly one Command Center queue item. Use only the listed tools. Never claim an unsupported queue type can be automated. When this is a nudge, use only the tool(s) valid for its kind. Ask one concise clarification when required information is missing. Do not execute anything; propose a tool call for the founder to confirm. Context:\n${context}` },
        ...body.data.history,
        { role: "user", content: body.data.message },
      ],
      tools: allowedTools,
      tool_choice: "auto",
    } as any);
    const message = completion.choices[0]?.message as any;
    const call = message?.tool_calls?.[0];
    let proposal = null;
    if (call?.function?.name) {
      const permitted = allowedTools.some((tool) => tool.function.name === call.function.name);
      if (item.type === "nudge" && !permitted) {
        return res.json({ assistant: "That action isn't available for this nudge kind.", proposal: null, unavailable: true });
      }
      proposal = { name: call.function.name, arguments: JSON.parse(call.function.arguments || "{}") };
    }
    return res.json({ assistant: message?.content ?? (proposal ? "I have a proposed action ready for your confirmation." : "What detail should I use to resolve this item?"), proposal, unavailable: false });
  } catch (err) {
    req.log.error(err);
    return res.status(502).json({ error: "Asher could not prepare a resolution" });
  }
});

const ResolveConfirmBody = z.object({ name: z.string(), arguments: z.unknown() });

router.post("/queue/:id/resolve/confirm", requireAuth, async (req, res) => {
  const itemId = Number(req.params.id);
  const body = ResolveConfirmBody.safeParse(req.body);
  if (!Number.isFinite(itemId) || !body.success) return res.status(400).json({ error: "A proposed tool call is required" });

  try {
    const userId = requireUserId(req);
    const item = await loadOwnedQueueItem(userId, itemId);
    if (!item) return res.status(404).json({ error: "Queue item not found" });
    if (item.status !== "pending") return res.status(400).json({ error: "Queue item already resolved" });

    if (item.type === "nudge") {
      const allowedTools = allowedQueueResolveToolsForItem(item);
      const permitted = allowedTools.some((tool) => tool.function.name === body.data.name);
      if (!permitted) {
        return res.status(400).json({ error: "That action is not allowed for this nudge kind" });
      }
    }

    const executed = await executeQueueResolveTool(userId, body.data.name, body.data.arguments);
    const [updated] = await db.update(queueItemsTable).set({ status: "accepted", resolvedAt: new Date() }).where(and(eq(queueItemsTable.id, itemId), eq(queueItemsTable.userId, userId), eq(queueItemsTable.status, "pending"))).returning();
    if (!updated) return res.status(409).json({ error: "Queue item changed before confirmation" });
    return res.json({ item: updated, result: executed.result });
  } catch (err) {
    req.log.error(err);
    const status = isUserFacingError(err) ? err.status : 400;
    return res.status(status).json({
      error: messageForCaller(err, "Tool execution failed; the item remains pending"),
    });
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
