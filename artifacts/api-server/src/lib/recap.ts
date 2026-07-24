import { db, venusDecisionsTable, monthlyRecapsTable } from "@workspace/db";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { getUsageStats } from "./dailyBrief";

export interface MonthlyRecapData {
  decisionsCaptured: number;
  lessonsLearned: number;
  automationsCompleted: number;
  timeSavedMinutes: number;
  goalsCompleted: number;
  // Best-effort derivations, not guaranteed present — full design for this
  // section is explicitly deferred (see monthly_recaps.ts), so these stay
  // null rather than fabricated when there isn't enough signal yet.
  biggestFocus: string | null;
  topRecommendation: string | null;
}

function monthBounds(periodMonth: string): { start: Date; end: Date } {
  const [year, month] = periodMonth.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

export async function generateMonthlyRecap(userId: string, periodMonth: string): Promise<MonthlyRecapData> {
  const { start, end } = monthBounds(periodMonth);

  const [usage, monthDecisions] = await Promise.all([
    getUsageStats(userId),
    db
      .select({ decisionType: venusDecisionsTable.decisionType, lesson: venusDecisionsTable.lesson, createdAt: venusDecisionsTable.createdAt })
      .from(venusDecisionsTable)
      .where(and(eq(venusDecisionsTable.sessionId, userId), gte(venusDecisionsTable.createdAt, start), lt(venusDecisionsTable.createdAt, end)))
      .orderBy(desc(venusDecisionsTable.createdAt)),
  ]);

  const typeCounts = new Map<string, number>();
  for (const d of monthDecisions) {
    if (!d.decisionType) continue;
    typeCounts.set(d.decisionType, (typeCounts.get(d.decisionType) ?? 0) + 1);
  }
  let biggestFocus: string | null = null;
  let topCount = 0;
  for (const [type, count] of typeCounts) {
    if (count > topCount) {
      biggestFocus = type;
      topCount = count;
    }
  }

  const topRecommendation = monthDecisions.find((d) => d.lesson)?.lesson ?? null;

  return {
    decisionsCaptured: usage.decisionsCaptured,
    lessonsLearned: usage.lessonsLearned,
    automationsCompleted: usage.automationsCompleted,
    timeSavedMinutes: usage.timeSavedMinutes,
    goalsCompleted: usage.goalsCompleted,
    biggestFocus,
    topRecommendation,
  };
}

// Idempotent per (userId, periodMonth) — safe to call from a daily job that
// might run more than once on the actual last day of the month.
export async function ensureMonthlyRecap(userId: string, periodMonth: string): Promise<boolean> {
  const data = await generateMonthlyRecap(userId, periodMonth);
  const inserted = await db
    .insert(monthlyRecapsTable)
    .values({ userId, periodMonth, dataJson: JSON.stringify(data) })
    .onConflictDoNothing({ target: [monthlyRecapsTable.userId, monthlyRecapsTable.periodMonth] })
    .returning({ id: monthlyRecapsTable.id });
  return inserted.length > 0;
}

export function isLastDayOfMonth(date: Date): boolean {
  const tomorrow = new Date(date);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return tomorrow.getUTCMonth() !== date.getUTCMonth();
}

export function currentPeriodMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
