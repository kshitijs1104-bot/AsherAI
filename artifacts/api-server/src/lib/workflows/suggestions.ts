import { db, queueItemsTable } from "@workspace/db";
import { and, eq, gte } from "drizzle-orm";

const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const REPEAT_THRESHOLD = 2;

const ACTION_TYPE_LABEL: Record<string, string> = {
  draft_reply: "drafting replies",
  sell_this: "writing sales copy",
  summarize: "summarizing text",
  follow_up: "drafting follow-ups",
};

// Section 5's proactive suggestion mechanic: "the same manual action
// detected 2+ times -> surface a queue item suggesting automation." Instant
// Actions (source="instant_action", see routes/actions.ts) are the signal
// used here — a founder reaching for the same Quick Action repeatedly in a
// week is exactly the "doing this by hand every time" pattern worth
// flagging. One suggestion per action type, ever (see externalId below) —
// once surfaced, whether accepted or dismissed, it doesn't need to repeat.
export async function checkAutomationSuggestions(userId: string): Promise<number> {
  const since = new Date(Date.now() - LOOKBACK_MS);
  const recentActions = await db
    .select({ type: queueItemsTable.type })
    .from(queueItemsTable)
    .where(and(eq(queueItemsTable.userId, userId), eq(queueItemsTable.source, "instant_action"), gte(queueItemsTable.createdAt, since)));

  const counts = new Map<string, number>();
  for (const row of recentActions) counts.set(row.type, (counts.get(row.type) ?? 0) + 1);

  let created = 0;
  for (const [type, count] of counts) {
    if (count < REPEAT_THRESHOLD) continue;
    const label = ACTION_TYPE_LABEL[type] ?? type;

    const inserted = await db
      .insert(queueItemsTable)
      .values({
        userId,
        type: "automation_suggestion",
        source: "workflow",
        title: `I noticed you do this a lot — automate it?`,
        body: `You've used ${label} ${count} times this week. Want Asher to handle this automatically going forward?`,
        externalId: `suggest-${type}`,
      })
      .onConflictDoNothing({ target: [queueItemsTable.userId, queueItemsTable.source, queueItemsTable.externalId] })
      .returning({ id: queueItemsTable.id });
    created += inserted.length;
  }
  return created;
}
