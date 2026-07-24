import { db, connectorsTable, queueItemsTable, type Workflow } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getTopOpenDecision, getBiggestRiskGoal } from "../dailyBrief";
import { pollConnector } from "../connectors/poll";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

// Shared by every workflow that's really just "poll this connector on a
// schedule" (gmail-auto-reply, weekly-report-sheets) — the workflow layer's
// only job is deciding WHEN, the connector's poller (see connectors/poll.ts)
// still owns HOW.
async function runConnectorPoll(userId: string, type: string): Promise<number> {
  const [connector] = await db
    .select()
    .from(connectorsTable)
    .where(and(eq(connectorsTable.userId, userId), eq(connectorsTable.type, type)))
    .limit(1);
  if (!connector || connector.status !== "connected") {
    throw new Error(`${type} isn't connected — connect it to run this workflow`);
  }
  return pollConnector(userId, connector);
}

async function runWeeklyDecisionFollowup(userId: string): Promise<number> {
  const decision = await getTopOpenDecision(userId);
  if (!decision || !decision.createdAt) return 0;
  if (Date.now() - decision.createdAt.getTime() < THREE_DAYS_MS) return 0;

  const inserted = await db
    .insert(queueItemsTable)
    .values({
      userId,
      type: "decision_followup",
      source: "workflow:weekly-decision-followup",
      title: "Still open: what happened with this decision?",
      body: decision.query,
      externalId: `decision-${decision.id}`,
    })
    .onConflictDoNothing({ target: [queueItemsTable.userId, queueItemsTable.source, queueItemsTable.externalId] })
    .returning({ id: queueItemsTable.id });
  return inserted.length;
}

async function runStaleGoalNudge(userId: string): Promise<number> {
  const goal = await getBiggestRiskGoal(userId);
  if (!goal) return 0;

  const inserted = await db
    .insert(queueItemsTable)
    .values({
      userId,
      type: "goal_risk",
      source: "workflow:stale-goal-nudge",
      title: goal.risk === "off_track" ? "Goal is off track" : "Goal is at risk",
      body: goal.title,
      // Dedupe key intentionally omits a timestamp so re-flagging the SAME
      // goal doesn't spam a new row every week while it stays at risk — the
      // existing pending item is the standing reminder until it's resolved.
      externalId: `goal-${goal.id}`,
    })
    .onConflictDoNothing({ target: [queueItemsTable.userId, queueItemsTable.source, queueItemsTable.externalId] })
    .returning({ id: queueItemsTable.id });
  return inserted.length;
}

// One place mapping a workflow's templateId to its run function — same
// "single dispatcher, not scattered per-template branches" shape as
// connectors/poll.ts. Returns the number of NEW queue items created.
export async function runWorkflow(userId: string, workflow: Workflow): Promise<number> {
  switch (workflow.templateId) {
    case "gmail-auto-reply":
      return runConnectorPoll(userId, "gmail");
    case "weekly-decision-followup":
      return runWeeklyDecisionFollowup(userId);
    case "stale-goal-nudge":
      return runStaleGoalNudge(userId);
    case "weekly-report-sheets":
      return runConnectorPoll(userId, "sheets");
    default:
      throw new Error(`No run implementation for workflow template "${workflow.templateId}"`);
  }
}
