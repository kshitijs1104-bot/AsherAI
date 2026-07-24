import { Router } from "express";
import { db, queueItemsTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireUserId } from "../middlewares/auth";
import { performQueueItemSendAction } from "../lib/connectors/sendAction";

const router = Router();

// Command Center's queue backer. Every row here is something Vera already
// drafted/decided/found — this is deliberately never a "create" endpoint for
// the founder; items only ever arrive via connectors/workflows/decision
// follow-ups (later phases) or, for now, the first-run demo seed below.
const DEMO_ITEMS: { type: string; source: string; title: string; body: string; draftContent: string | null }[] = [
  {
    type: "draft_reply",
    source: "gmail",
    title: "Reply drafted for Priya (Northwind Retail)",
    body: "Asked about the Q3 pricing tier — drafted a reply covering the volume discount and renewal timeline.",
    draftContent:
      "Hi Priya,\n\nThanks for flagging this — for the volume you're at, the Q3 tier works out to the discounted rate we discussed on the call. I've attached the updated schedule; happy to lock in the renewal date whenever works for you.\n\nBest,\n",
  },
  {
    type: "insight",
    source: "connector:sheets",
    title: "Weekly revenue sheet: 3rd week of flat MRR",
    body: "Your tracked revenue sheet has shown no net new MRR for 3 consecutive weekly syncs — usually the first sign worth a look before it shows up in the monthly numbers.",
    draftContent: null,
  },
  {
    type: "automation_suggestion",
    source: "workflow",
    title: "Automate: weekly report from Sheets",
    body: "You've manually pulled the same weekly numbers into a summary twice now — Vera can generate this automatically every Monday from your connected sheet.",
    draftContent: null,
  },
];

async function ensureDemoSeed(userId: string) {
  const [existing] = await db.select({ id: queueItemsTable.id }).from(queueItemsTable).where(eq(queueItemsTable.userId, userId)).limit(1);
  if (existing) return;
  await db.insert(queueItemsTable).values(DEMO_ITEMS.map((item) => ({ userId, ...item })));
}

// GET /queue — pending items first (oldest first, so the founder clears the
// queue in the order things came in), then resolved items most-recent-first
// as a short history underneath. Capped at 50: this is a daily workspace,
// not an archive browser.
router.get("/queue", requireAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    await ensureDemoSeed(userId);

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
      .where(eq(queueItemsTable.id, itemId))
      .returning();

    return res.json({ item: updated });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update queue item" });
  }
});

export default router;
