import { db, goalsTable, venusDecisionsTable, roadmapsTable, companyFactsTable, messagesTable, queueItemsTable } from "@workspace/db";
import { and, desc, eq, isNotNull, isNull, inArray } from "drizzle-orm";
import { attachGoalProgress } from "../routes/chats";
import { parsePhases } from "./roadmap";

// Read-time rollup for the Decision Inbox — four independent, best-effort
// lookups over tables that already exist (goals, venus_decisions, roadmaps,
// company_facts). Nothing here is stored; like goalEvidence.ts's
// assessGoalRisk, every function is a derivation over current rows and can
// be re-tuned later without a migration. Each degrades to null on no-data
// or error rather than throwing, matching companyMemory.ts's philosophy —
// a missing inbox item is a normal day, not a failure.

export type TopOpenDecision = typeof venusDecisionsTable.$inferSelect;

// Highest-priority open decision = the one the founder has asked about
// (or been given) most often and most recently, and hasn't resolved or
// archived. reinforcedCount is the existing signal for "this keeps coming
// up" (see decisionMemory.ts) — the natural proxy for priority without
// inventing a new field.
export async function getTopOpenDecision(userId: string): Promise<TopOpenDecision | null> {
  try {
    const [row] = await db
      .select()
      .from(venusDecisionsTable)
      .where(
        and(
          eq(venusDecisionsTable.sessionId, userId),
          eq(venusDecisionsTable.status, "open"),
          eq(venusDecisionsTable.archived, false),
        ),
      )
      .orderBy(desc(venusDecisionsTable.reinforcedCount), desc(venusDecisionsTable.createdAt))
      .limit(1);
    return row ?? null;
  } catch (err) {
    console.error("[dailyBrief] failed to load top open decision", err);
    return null;
  }
}

export type GoalWithProgress = Awaited<ReturnType<typeof attachGoalProgress>>;

const RISK_RANK: Record<GoalWithProgress["risk"], number> = { off_track: 2, at_risk: 1, on_track: 0 };

// Biggest risk = the active goal whose evidence-vs-time trajectory (the
// SAME assessGoalRisk read-time judgment GoalPanel already renders) is
// worst, tie-broken by whichever deadline is soonest. A goal that's
// on_track isn't a "risk" worth an inbox slot at all, even if it's the
// least-good of a good set — this only ever surfaces real risk.
export async function getBiggestRiskGoal(userId: string): Promise<GoalWithProgress | null> {
  try {
    const rows = await db
      .select()
      .from(goalsTable)
      .where(and(eq(goalsTable.userId, userId), eq(goalsTable.status, "active")));
    if (rows.length === 0) return null;

    const withProgress = await Promise.all(rows.map((g) => attachGoalProgress(g)));
    withProgress.sort((a, b) => {
      const riskDiff = RISK_RANK[b.risk] - RISK_RANK[a.risk];
      if (riskDiff !== 0) return riskDiff;
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });

    const worst = withProgress[0];
    return worst.risk === "on_track" ? null : worst;
  } catch (err) {
    console.error("[dailyBrief] failed to load biggest risk goal", err);
    return null;
  }
}

export interface BlockedRoadmapAction {
  roadmapId: number;
  roadmapTitle: string;
  phasePeriod: string;
  actionText: string;
}

// "Blocked task" proxy — roadmaps store actions as pending/done/skipped
// with no explicit blocked flag or per-action timestamp (see roadmap.ts),
// so this surfaces the first still-pending action in plan order (the
// current frontier of the plan), preferring whichever roadmap belongs to
// the chat behind getBiggestRiskGoal (the plan most likely to actually be
// stuck) and otherwise the active roadmap that's gone longest without any
// update.
export async function getBlockedRoadmapAction(
  userId: string,
  preferredChatId?: number | null,
): Promise<BlockedRoadmapAction | null> {
  try {
    const rows = await db
      .select()
      .from(roadmapsTable)
      .where(and(eq(roadmapsTable.userId, userId), eq(roadmapsTable.status, "active")));
    if (rows.length === 0) return null;

    const ordered = [...rows].sort((a, b) => {
      if (preferredChatId != null) {
        if (a.chatId === preferredChatId && b.chatId !== preferredChatId) return -1;
        if (b.chatId === preferredChatId && a.chatId !== preferredChatId) return 1;
      }
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return aTime - bTime;
    });

    for (const roadmap of ordered) {
      for (const phase of parsePhases(roadmap)) {
        const action = phase.actions.find((a) => a.status === "pending");
        if (action) {
          return { roadmapId: roadmap.id, roadmapTitle: roadmap.title, phasePeriod: phase.period, actionText: action.text };
        }
      }
    }
    return null;
  } catch (err) {
    console.error("[dailyBrief] failed to load blocked roadmap action", err);
    return null;
  }
}

export interface AssumptionChange {
  previousText: string | null;
  currentText: string;
  changedAt: Date | null;
}

// "Assumption that changed" — prefers a real supersession pair (a fact
// explicitly corrected via supersedeFact, see companyMemory.ts) so the
// founder sees exactly what was believed before and what replaced it.
// Falls back to the latest Morning Check-In-sourced fact when no
// supersession has happened yet, so this slot has real content from the
// very first check-in instead of staying empty until a correction occurs.
export async function getRecentAssumptionChange(userId: string): Promise<AssumptionChange | null> {
  try {
    const [superseded] = await db
      .select()
      .from(companyFactsTable)
      .where(and(eq(companyFactsTable.userId, userId), isNotNull(companyFactsTable.supersededBy)))
      .orderBy(desc(companyFactsTable.updatedAt))
      .limit(1);

    if (superseded?.supersededBy) {
      const [replacement] = await db
        .select()
        .from(companyFactsTable)
        .where(eq(companyFactsTable.id, superseded.supersededBy))
        .limit(1);
      if (replacement) {
        return { previousText: superseded.factText, currentText: replacement.factText, changedAt: replacement.createdAt };
      }
    }

    const [latestCheckin] = await db
      .select()
      .from(companyFactsTable)
      .where(
        and(
          eq(companyFactsTable.userId, userId),
          eq(companyFactsTable.sourceType, "checkin"),
          isNull(companyFactsTable.supersededBy),
        ),
      )
      .orderBy(desc(companyFactsTable.createdAt))
      .limit(1);

    if (latestCheckin) {
      return { previousText: null, currentText: latestCheckin.factText, changedAt: latestCheckin.createdAt };
    }

    return null;
  } catch (err) {
    console.error("[dailyBrief] failed to load recent assumption change", err);
    return null;
  }
}

// ---- Usage stats: the "why should I trust this daily" counter-strip ----
//
// Not a new subsystem — just a read-time rollup over rows every other
// feature already writes (venus_decisions, goals, messages/company_facts as
// a usage-date proxy). The point isn't the exact numbers, it's giving the
// founder a concrete, growing "this is compounding" signal every time they
// open the app, instead of only the passive once-a-day inbox above.
//
// valueTrackedInr is deliberately labeled and described as tracked GOAL
// VALUE, never "profit" or "revenue" — Vera has no accounting integration,
// so claiming a real financial number would be a fabricated precision this
// codebase's own prompt rules (NO FAKE PRECISION) explicitly forbid; the
// only honest number here is the founder's own stated value on goals they
// marked complete.
export interface UsageStats {
  decisionsResolved: number;
  goalsCompleted: number;
  goalsActive: number;
  daysActive: number;
  valueTrackedInr: number;

  // ---- Business Stats row (see section 7 of the build plan) ----
  // Deliberately no percentage/completeness score anywhere in this set —
  // every one of these is a plain accumulating count of real activity, the
  // kind that only ever goes up, so a founder reads "operating history I'm
  // building" rather than "a profile I haven't finished filling out."
  decisionsCaptured: number;
  lessonsLearned: number;
  automationsCompleted: number;
  timeSavedMinutes: number;
  // Consecutive days (ending today or yesterday) with at least one queue
  // item actually acted on (accepted/edited — opening Command Center and
  // looking doesn't count). 0 the moment a day is skipped entirely.
  queueStreakDays: number;
}

function countDistinctDays(dateLists: (Date | null)[][]): number {
  const days = new Set<string>();
  for (const list of dateLists) {
    for (const d of list) {
      if (d) days.add(new Date(d).toISOString().slice(0, 10));
    }
  }
  return days.size;
}

// Streak semantics match a normal daily-streak counter (Duolingo-style): a
// day counts only if it has >=1 qualifying action, and the streak is still
// "alive" through today even if today has nothing yet — it only breaks once
// a full day has passed with zero action. Dates are bucketed by UTC
// calendar day (same convention as countDistinctDays above), not the
// founder's local timezone — acceptable drift for a "you're building
// something" signal, not something worth a per-user timezone lookup for.
function computeQueueStreak(resolvedDates: (Date | null)[]): number {
  const activeDays = new Set(resolvedDates.filter((d): d is Date => !!d).map((d) => d.toISOString().slice(0, 10)));
  if (activeDays.size === 0) return 0;

  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  if (!activeDays.has(cursor.toISOString().slice(0, 10))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1); // today not yet active — streak can still extend from yesterday
    if (!activeDays.has(cursor.toISOString().slice(0, 10))) return 0; // yesterday empty too — streak is broken
  }

  let streak = 0;
  while (activeDays.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

// A flat per-item estimate, not a measured value — there's no real timer on
// how long a founder would have spent hand-writing a reply or pulling a
// report themselves. Automation-sourced items (a connector or workflow did
// the work end-to-end) are weighted higher than instant actions (the
// founder still had to type the input themselves).
const MINUTES_SAVED_PER_AUTOMATION = 8;
const MINUTES_SAVED_PER_INSTANT_ACTION = 4;

export async function getUsageStats(userId: string): Promise<UsageStats> {
  const [decisionsResolved, goalRows, messageDays, decisionDays, factDays, decisionsCaptured, lessonsLearned, resolvedQueueRows] =
    await Promise.all([
      db.select({ id: venusDecisionsTable.id }).from(venusDecisionsTable)
        .where(and(eq(venusDecisionsTable.sessionId, userId), eq(venusDecisionsTable.status, "resolved")))
        .then((rows) => rows.length)
        .catch((err) => { console.error("[dailyBrief] usageStats: decisionsResolved failed", err); return 0; }),
      db.select({ status: goalsTable.status, valueInr: goalsTable.valueInr }).from(goalsTable)
        .where(eq(goalsTable.userId, userId))
        .catch((err) => { console.error("[dailyBrief] usageStats: goals failed", err); return [] as { status: string; valueInr: number }[]; }),
      // Best-effort — the messages table is the real usage log going forward,
      // but degrades to empty gracefully (e.g. before its migration has run)
      // rather than breaking this whole stat strip.
      db.select({ createdAt: messagesTable.createdAt }).from(messagesTable)
        .where(eq(messagesTable.userId, userId))
        .then((rows) => rows.map((r) => r.createdAt))
        .catch(() => [] as (Date | null)[]),
      db.select({ createdAt: venusDecisionsTable.createdAt }).from(venusDecisionsTable)
        .where(eq(venusDecisionsTable.sessionId, userId))
        .then((rows) => rows.map((r) => r.createdAt))
        .catch(() => [] as (Date | null)[]),
      db.select({ createdAt: companyFactsTable.createdAt }).from(companyFactsTable)
        .where(eq(companyFactsTable.userId, userId))
        .then((rows) => rows.map((r) => r.createdAt))
        .catch(() => [] as (Date | null)[]),
      db.select({ id: venusDecisionsTable.id }).from(venusDecisionsTable)
        .where(and(eq(venusDecisionsTable.sessionId, userId), eq(venusDecisionsTable.archived, false)))
        .then((rows) => rows.length)
        .catch(() => 0),
      db.select({ id: venusDecisionsTable.id }).from(venusDecisionsTable)
        .where(and(eq(venusDecisionsTable.sessionId, userId), isNotNull(venusDecisionsTable.lesson)))
        .then((rows) => rows.length)
        .catch(() => 0),
      db.select({ source: queueItemsTable.source, resolvedAt: queueItemsTable.resolvedAt })
        .from(queueItemsTable)
        .where(and(eq(queueItemsTable.userId, userId), inArray(queueItemsTable.status, ["accepted", "edited"])))
        .catch(() => [] as { source: string; resolvedAt: Date | null }[]),
    ]);

  const goalsCompleted = goalRows.filter((g) => g.status === "completed").length;
  const goalsActive = goalRows.filter((g) => g.status === "active").length;
  const valueTrackedInr = goalRows
    .filter((g) => g.status === "completed")
    .reduce((sum, g) => sum + (g.valueInr ?? 0), 0);
  // Union across sources so this reads real usage from day one (before the
  // messages table has real history) and still becomes messages-driven
  // (the true per-turn log) as that table fills in going forward.
  const daysActive = countDistinctDays([messageDays, decisionDays, factDays]);

  const automationRows = resolvedQueueRows.filter((r) => r.source !== "instant_action");
  const instantActionRows = resolvedQueueRows.filter((r) => r.source === "instant_action");
  const automationsCompleted = automationRows.length;
  const timeSavedMinutes = automationRows.length * MINUTES_SAVED_PER_AUTOMATION + instantActionRows.length * MINUTES_SAVED_PER_INSTANT_ACTION;
  const queueStreakDays = computeQueueStreak(resolvedQueueRows.map((r) => r.resolvedAt));

  return {
    decisionsResolved,
    goalsCompleted,
    goalsActive,
    daysActive,
    valueTrackedInr,
    decisionsCaptured,
    lessonsLearned,
    automationsCompleted,
    timeSavedMinutes,
    queueStreakDays,
  };
}
