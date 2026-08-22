import { Router } from "express";
import { db, chatsTable, goalsTable, venusDecisionsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  CreateChatBody,
  UpdateChatBody,
  SetChatGoalBody,
  SetGoalStatusBody,
} from "@workspace/api-zod";
import { requireAuth, requireUserId } from "../middlewares/auth";
import { evidenceScoreToPosition, assessGoalRisk } from "../lib/goalEvidence";
import { getRecentMessages } from "../lib/messageLog";
import { deleteChatData } from "../lib/dataDeletion";

const router = Router();

// Shapes a DB goal row plus its derived, read-time-only fields (position on
// the Origin──Target line, risk level, and the roadmap/decision cards logged
// against it) into what the frontend actually renders. None of `position`,
// `risk`, or `subTasks` are stored — they're recomputed on every read so the
// stored evidenceScore stays the single source of truth and the visual
// mapping/risk heuristic can be tuned later without a migration.
export async function attachGoalProgress(goal: typeof goalsTable.$inferSelect) {
  const subTaskRows = await db
    .select({
      id: venusDecisionsTable.id,
      cardType: venusDecisionsTable.cardType,
      recommendationSummary: venusDecisionsTable.recommendationSummary,
      status: venusDecisionsTable.status,
      outcomeSentiment: venusDecisionsTable.outcomeSentiment,
    })
    .from(venusDecisionsTable)
    .where(eq(venusDecisionsTable.chatId, goal.chatId))
    .orderBy(desc(venusDecisionsTable.createdAt));

  return {
    ...goal,
    position: evidenceScoreToPosition(goal.evidenceScore),
    risk: assessGoalRisk({
      evidenceScore: goal.evidenceScore,
      createdAt: goal.createdAt ?? new Date(),
      deadline: goal.deadline,
    }),
    subTasks: subTaskRows.map((r) => ({
      id: r.id,
      cardType: r.cardType as "decision" | "roadmap",
      summary: r.recommendationSummary,
      status: r.status as "open" | "resolved" | "abandoned",
      outcomeSentiment: (r.outcomeSentiment ?? null) as "positive" | "negative" | "mixed" | null,
    })),
  };
}

router.get("/chats", requireAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const rows = await db
      .select()
      .from(chatsTable)
      .where(eq(chatsTable.userId, userId))
      .orderBy(desc(chatsTable.updatedAt));
    return res.json({ chats: rows });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to list chats" });
  }
});

router.post("/chats", requireAuth, async (req, res) => {
  try {
    const body = CreateChatBody.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: "Invalid request body" });

    const userId = requireUserId(req);
    const [created] = await db
      .insert(chatsTable)
      .values({ userId, title: body.data.title || "New Chat" })
      .returning();

    return res.json(created);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to create chat" });
  }
});

router.get("/chats/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid chat id" });

  try {
    const userId = requireUserId(req);
    const [chat] = await db
      .select()
      .from(chatsTable)
      .where(and(eq(chatsTable.id, id), eq(chatsTable.userId, userId)))
      .limit(1);
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    const [goal] = await db
      .select()
      .from(goalsTable)
      .where(eq(goalsTable.chatId, id))
      .limit(1);

    return res.json({
      ...chat,
      goal: goal ? await attachGoalProgress(goal) : null,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get chat" });
  }
});

router.patch("/chats/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid chat id" });

  const body = UpdateChatBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid request body" });

  try {
    const userId = requireUserId(req);
    const [updated] = await db
      .update(chatsTable)
      .set({ title: body.data.title, updatedAt: new Date() })
      .where(and(eq(chatsTable.id, id), eq(chatsTable.userId, userId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Chat not found" });
    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to update chat" });
  }
});

router.delete("/chats/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid chat id" });

  try {
    const userId = requireUserId(req);
    const [owned] = await db
      .select({ id: chatsTable.id })
      .from(chatsTable)
      .where(and(eq(chatsTable.id, id), eq(chatsTable.userId, userId)))
      .limit(1);
    if (!owned) return res.status(404).json({ error: "Chat not found" });

    // Used to be two statements: delete the goal, delete the chat. That left
    // the permanent message log, every attachment row, every uploaded FILE on
    // disk plus its cached extraction, the roadmap, the decision cards and the
    // feedback rows — so "delete chat" removed the chat from the list and kept
    // the conversation. Section 7 of the privacy policy now tells founders that
    // deleting a chat deletes its transcript, its files and what Vera derived
    // from them, so it has to actually do that. See lib/dataDeletion.ts.
    const report = await deleteChatData(userId, id);
    await db.delete(chatsTable).where(eq(chatsTable.id, id));

    req.log.info({ chatId: id, ...report }, "Deleted a chat and everything derived from it");
    return res.json({ deleted: true, removed: report });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to delete chat" });
  }
});

// The transcript, from the permanent server-side log (see lib/messageLog.ts).
//
// WHY THIS EXISTS. Chat history is kept in the browser's localStorage, and a
// server chat id is only joined to it by the local session that created it.
// Anything that links TO a chat by its server id — a decision on the Decisions
// page, a follow-up on the Command Centre board — therefore had nothing to
// open when that local session was missing: cleared history, a different
// device, or simply the 51st chat, since only 50 are kept. The client's
// response to a miss was to fall back to the most recent session, so "Open
// chat" on a decision opened somebody else's conversation. This endpoint is
// what lets the client rebuild the real thread instead of guessing.
//
// Text only: the log stores what was said, not the cards rendered alongside
// it. A rehydrated thread is an honest transcript rather than a pixel-perfect
// replay, which is the right trade against opening the wrong chat entirely.
router.get("/chats/:id/messages", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid chat id" });

  try {
    const userId = requireUserId(req);
    const chat = await loadOwnedChat(id, userId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    const rows = await getRecentMessages(userId, id, 200);
    return res.json({
      chat: { id: chat.id, title: chat.title, createdAt: chat.createdAt },
      messages: rows.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })),
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to load this chat" });
  }
});

// --- Goal sub-resource ------------------------------------------------

async function loadOwnedChat(chatId: number, userId: string) {
  const [chat] = await db
    .select()
    .from(chatsTable)
    .where(and(eq(chatsTable.id, chatId), eq(chatsTable.userId, userId)))
    .limit(1);
  return chat;
}

router.get("/chats/:id/goal", requireAuth, async (req, res) => {
  const chatId = Number(req.params.id);
  if (!Number.isFinite(chatId)) return res.status(400).json({ error: "Invalid chat id" });

  try {
    const userId = requireUserId(req);
    const chat = await loadOwnedChat(chatId, userId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    const [goal] = await db.select().from(goalsTable).where(eq(goalsTable.chatId, chatId)).limit(1);
    if (!goal) return res.status(404).json({ error: "No goal set on this chat" });

    return res.json(await attachGoalProgress(goal));
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get goal" });
  }
});

// Sets (or fully replaces) the goal on a chat. Deliberately upsert-by-chatId
// rather than "you must delete first" — switching what a chat's goal says
// happens as one action from the founder's point of view (this mirrors
// editing a Claude Project's custom instructions in place), and the OLD
// goal's resolved evidence isn't discarded by this: only THIS goal row's own
// title/metric/value/deadline/evidenceScore are replaced. If the founder
// actually wants a fresh, separate goal with its own history, the product
// answer is a new chat, not overwriting this one repeatedly — but the API
// itself doesn't need to enforce that; it just does what's asked to chatId.
router.put("/chats/:id/goal", requireAuth, async (req, res) => {
  const chatId = Number(req.params.id);
  if (!Number.isFinite(chatId)) return res.status(400).json({ error: "Invalid chat id" });

  const body = SetChatGoalBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({
      error: "A goal needs a title, successMetric, valueInr, and deadline — without all four Asher can't reason about urgency or trade-offs.",
    });
  }

  try {
    const userId = requireUserId(req);
    const chat = await loadOwnedChat(chatId, userId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    const [existing] = await db.select().from(goalsTable).where(eq(goalsTable.chatId, chatId)).limit(1);

    const values = {
      chatId,
      userId,
      title: body.data.title,
      successMetric: body.data.successMetric,
      valueInr: body.data.valueInr,
      deadline: new Date(body.data.deadline),
    };

    const [saved] = existing
      ? await db
          .update(goalsTable)
          .set({ ...values, status: "active", updatedAt: new Date(), resolvedAt: null })
          .where(eq(goalsTable.chatId, chatId))
          .returning()
      : await db.insert(goalsTable).values(values).returning();

    return res.json(await attachGoalProgress(saved));
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to save goal" });
  }
});

router.delete("/chats/:id/goal", requireAuth, async (req, res) => {
  const chatId = Number(req.params.id);
  if (!Number.isFinite(chatId)) return res.status(400).json({ error: "Invalid chat id" });

  try {
    const userId = requireUserId(req);
    const chat = await loadOwnedChat(chatId, userId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    await db.delete(goalsTable).where(eq(goalsTable.chatId, chatId));
    return res.json({ deleted: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to clear goal" });
  }
});

// Marks the goal resolved one way or the other. History is retained (the row
// is kept, not deleted) so a completed or abandoned goal's evidence stays
// real Decision Memory precedent — only `status` and `resolvedAt` change.
router.patch("/chats/:id/goal/status", requireAuth, async (req, res) => {
  const chatId = Number(req.params.id);
  if (!Number.isFinite(chatId)) return res.status(400).json({ error: "Invalid chat id" });

  const body = SetGoalStatusBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "status must be 'completed', 'abandoned', or 'active'" });

  try {
    const userId = requireUserId(req);
    const chat = await loadOwnedChat(chatId, userId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    // "active" is the undo path for an accidental complete/abandon click —
    // resolvedAt gets cleared (this goal is no longer resolved), everything
    // else (evidenceScore, evidenceLog) is left exactly as it was, so
    // reopening never discards real evidence history.
    const [updated] = await db
      .update(goalsTable)
      .set({
        status: body.data.status,
        resolvedAt: body.data.status === "active" ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(goalsTable.chatId, chatId))
      .returning();
    if (!updated) return res.status(404).json({ error: "No goal set on this chat" });

    return res.json(await attachGoalProgress(updated));
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to update goal status" });
  }
});

export default router;
