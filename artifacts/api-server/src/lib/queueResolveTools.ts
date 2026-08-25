import { db, goalsTable, queueItemsTable, roadmapsTable, settingsTable, type QueueItem } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { performQueueItemSendAction } from "./connectors/sendAction";
import { setRoadmapActionStatus } from "./roadmap";

export const QUEUE_RESOLVE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "send_chat_reply",
      description: "Send the approved draft for this queue item through its existing connector thread.",
      parameters: { type: "object", properties: { queue_item_id: { type: "integer" }, message: { type: "string" } }, required: ["queue_item_id", "message"], additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_profile_field",
      description: "Update one approved founder profile field.",
      parameters: { type: "object", properties: { field: { type: "string", enum: ["displayName", "company", "role", "teamSize", "monthlyRevenue", "primaryGoal", "stage", "industry", "country"] }, value: { type: ["string", "null"] } }, required: ["field", "value"], additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_goal_status",
      description: "Set the status of the goal attached to a chat.",
      parameters: { type: "object", properties: { chat_id: { type: "integer" }, status: { type: "string", enum: ["active", "completed", "abandoned"] } }, required: ["chat_id", "status"], additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_roadmap_action",
      description: "Set one existing roadmap action to pending, done, or skipped.",
      parameters: { type: "object", properties: { roadmap_id: { type: "integer" }, phase_index: { type: "integer" }, action_index: { type: "integer" }, status: { type: "string", enum: ["pending", "done", "skipped"] } }, required: ["roadmap_id", "phase_index", "action_index", "status"], additionalProperties: false },
    },
  },
] as const;

const Args = {
  send_chat_reply: z.object({ queue_item_id: z.number().int().positive(), message: z.string().trim().min(1).max(20000) }),
  update_profile_field: z.object({ field: z.enum(["displayName", "company", "role", "teamSize", "monthlyRevenue", "primaryGoal", "stage", "industry", "country"]), value: z.string().trim().max(1000).nullable() }),
  update_goal_status: z.object({ chat_id: z.number().int().positive(), status: z.enum(["active", "completed", "abandoned"]) }),
  update_roadmap_action: z.object({ roadmap_id: z.number().int().positive(), phase_index: z.number().int().min(0), action_index: z.number().int().min(0), status: z.enum(["pending", "done", "skipped"]) }),
};

export type QueueResolveToolName = keyof typeof Args;

const PROFILE_COLUMNS = {
  displayName: "displayName", company: "companyName", role: "role", teamSize: "teamSize",
  monthlyRevenue: "monthlyRevenue", primaryGoal: "primaryGoal", stage: "stage", industry: "industry", country: "country",
} as const;

async function ownedQueueItem(userId: string, id: number): Promise<QueueItem> {
  const [item] = await db.select().from(queueItemsTable).where(and(eq(queueItemsTable.id, id), eq(queueItemsTable.userId, userId))).limit(1);
  if (!item) throw new Error("Queue item not found");
  if (item.status !== "pending") throw new Error("Queue item is no longer pending");
  return item;
}

export async function executeQueueResolveTool(userId: string, name: string, rawArgs: unknown): Promise<{ ok: true; result: unknown }> {
  if (!(name in Args)) throw new Error(`Tool is not permitted: ${name}`);
  const toolName = name as QueueResolveToolName;
  const args = Args[toolName].parse(rawArgs);

  if (toolName === "send_chat_reply") {
    const item = await ownedQueueItem(userId, args.queue_item_id);
    if (!item.draftContent) throw new Error("This queue item has no sendable draft");
    await performQueueItemSendAction(userId, { ...item, draftContent: args.message });
    return { ok: true, result: { queueItemId: item.id, sent: true } };
  }

  if (toolName === "update_profile_field") {
    const column = PROFILE_COLUMNS[args.field as keyof typeof PROFILE_COLUMNS];
    const update = { updatedAt: new Date(), [column]: args.value };
    const result = await db.update(settingsTable).set(update).where(eq(settingsTable.sessionId, userId)).returning({ id: settingsTable.id });
    if (!result[0]) throw new Error("Profile not found");
    return { ok: true, result: { field: args.field, updated: true } };
  }

  if (toolName === "update_goal_status") {
    const result = await db.update(goalsTable).set({ status: args.status, resolvedAt: args.status === "active" ? null : new Date(), updatedAt: new Date() }).where(and(eq(goalsTable.chatId, args.chat_id), eq(goalsTable.userId, userId))).returning({ id: goalsTable.id });
    if (!result[0]) throw new Error("Goal not found");
    return { ok: true, result: { goalId: result[0].id, status: args.status } };
  }

  const [ownedRoadmap] = await db.select({ id: roadmapsTable.id }).from(roadmapsTable).where(and(eq(roadmapsTable.id, args.roadmap_id), eq(roadmapsTable.userId, userId))).limit(1);
  if (!ownedRoadmap) throw new Error("Roadmap not found");
  const updated = await setRoadmapActionStatus(args.roadmap_id, args.phase_index, args.action_index, args.status);
  if (!updated) throw new Error("Invalid roadmap action");
  return { ok: true, result: { roadmapId: args.roadmap_id, updated: true } };
}