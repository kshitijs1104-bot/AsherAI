import { db, responseFeedbackTable, type ResponseFeedback } from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";

// Service layer for the correction log (see lib/db/src/schema/response_feedback.ts
// for why this table exists). Same never-throws philosophy as messageLog.ts and
// companyMemory.ts: capturing feedback is strictly additive, and must never be
// able to break the answer the founder is actually waiting on.

export interface RecordCorrectionInput {
  userId: string;
  chatId?: number;
  originalQuery?: string;
  originalResponse?: string;
  correctionText: string;
  detectedIssue?: string | null;
  issueClass?: string | null;
}

export async function recordCorrection(input: RecordCorrectionInput): Promise<void> {
  const correction = input.correctionText?.trim();
  if (!correction) return;
  try {
    await db.insert(responseFeedbackTable).values({
      userId: input.userId,
      chatId: input.chatId ?? null,
      originalQuery: input.originalQuery?.trim() || null,
      originalResponse: input.originalResponse?.trim() || null,
      correctionText: correction,
      detectedIssue: input.detectedIssue ?? null,
      issueClass: input.issueClass ?? null,
    });
  } catch (err) {
    // Most likely cause in a fresh environment: the migration hasn't been run
    // yet (`pnpm --filter @workspace/db push`). Degrade to "not captured"
    // rather than failing the request — identical handling to every other
    // newly-added table in this codebase.
    console.error("[responseFeedback] failed to record correction (has the response_feedback migration been run?)", err);
  }
}

/**
 * Every correction not yet folded into the eval corpus. Used by
 * scripts/src/vera-eval.ts to grow its regression set from real usage rather
 * than hand-authored cases.
 *
 * NOT userId-scoped on purpose — this is an operator/eval-time read across all
 * users to find failure patterns, never something served back into any
 * founder's chat. The per-user scoping that matters (one founder never sees
 * another's data) is enforced at every read that feeds a prompt; this function
 * feeds an offline test runner.
 */
export async function getUnconsumedFeedback(limit = 500): Promise<ResponseFeedback[]> {
  try {
    return await db
      .select()
      .from(responseFeedbackTable)
      .where(eq(responseFeedbackTable.consumedByEval, false))
      .orderBy(desc(responseFeedbackTable.createdAt))
      .limit(limit);
  } catch (err) {
    console.error("[responseFeedback] failed to load unconsumed feedback", err);
    return [];
  }
}

export async function markFeedbackConsumed(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await db
      .update(responseFeedbackTable)
      .set({ consumedByEval: true })
      .where(inArray(responseFeedbackTable.id, ids));
  } catch (err) {
    console.error("[responseFeedback] failed to mark feedback consumed", err);
  }
}

export interface IssueClassCount {
  issueClass: string;
  count: number;
}

/**
 * Failure-CLASS counts — the metric that actually generalizes. A pass/fail
 * tally against a fixed list of known-bad queries only ever measures the bugs
 * someone already thought to write down; a rate per class ("fabricated_entity
 * is 60% of corrections this month") stays meaningful as usage moves into
 * territory nobody anticipated.
 */
export async function getIssueClassBreakdown(userId?: string): Promise<IssueClassCount[]> {
  try {
    const rows = await db
      .select()
      .from(responseFeedbackTable)
      .where(userId ? eq(responseFeedbackTable.userId, userId) : undefined);
    const counts = new Map<string, number>();
    for (const r of rows) {
      const key = r.issueClass ?? "unclassified";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([issueClass, count]) => ({ issueClass, count }))
      .sort((a, b) => b.count - a.count);
  } catch (err) {
    console.error("[responseFeedback] failed to compute issue-class breakdown", err);
    return [];
  }
}
