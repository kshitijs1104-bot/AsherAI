import type Groq from "groq-sdk";
import {
  db,
  venusDecisionsTable,
  goalsTable,
  messagesTable,
  queueItemsTable,
  companyFactsTable,
  monthlyRecapsTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { callGroqJSON } from "./groq";

// ---- The monthly wrap ----
//
// The existing generateMonthlyRecap (lib/recap.ts) counts five lifetime
// totals and stops. That's a placeholder, and it reads like one: a founder
// looking at "decisionsCaptured: 34" learns nothing they didn't know.
//
// A wrap is worth opening for one reason: it tells you something about your
// own month that you could not see while living it. So everything here is
// MONTH-SCOPED and COMPARATIVE — this month against last month — and every
// number is derived from rows that already exist. Nothing is estimated,
// nothing is projected, and when a month is too quiet to say anything
// meaningful, it says that instead of dressing up three data points.
//
// The narrative is the only model-written part, and it is given the computed
// numbers and forbidden from producing any others. That division is the
// whole design: arithmetic in code, judgment in the model, never the reverse.

export interface WrapStat {
  key: string;
  label: string;
  value: number;
  previousValue: number | null;
  // Absent when there's no previous month to compare against — a first
  // month has no trend, and inventing one ("+100%") would be a lie.
  changePct: number | null;
  unit?: "count" | "minutes" | "inr";
}

export interface MonthlyWrap {
  periodMonth: string;
  monthLabel: string;
  // False when the month is too quiet for any of this to mean anything. The
  // UI shows an honest empty state rather than a wrap made of zeroes.
  hasSignal: boolean;
  stats: WrapStat[];
  topics: { topic: string; count: number }[];
  decisionsMade: { query: string; recommendation: string | null; status: string }[];
  goalsClosed: { title: string; status: string }[];
  lessons: string[];
  busiestDay: { date: string; count: number } | null;
  // Model-written, from the numbers above only. Null when generation is
  // unavailable (no key, quota) — the wrap still renders without it.
  narrative: { headline: string; story: string; oneThingToChange: string } | null;
}

function monthBounds(periodMonth: string): { start: Date; end: Date } {
  const [year, month] = periodMonth.split("-").map(Number);
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

function previousPeriod(periodMonth: string): string {
  const [year, month] = periodMonth.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(periodMonth: string): string {
  const [year, month] = periodMonth.split("-").map(Number);
  return `${new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${year}`;
}

function changePct(value: number, previous: number | null): number | null {
  if (previous == null) return null;
  if (previous === 0) return value === 0 ? 0 : null; // growth from zero isn't a percentage
  return Math.round(((value - previous) / previous) * 100);
}

interface RawMonth {
  messages: number;
  decisions: { query: string; recommendationSummary: string | null; status: string; decisionType: string | null; lesson: string | null; createdAt: Date | null }[];
  goalsClosed: { title: string; status: string }[];
  actionsTaken: number;
  factsLearned: number;
  messageDates: (Date | null)[];
}

// Every read is independently guarded: one missing migration (this codebase
// has several tables added at different times) must degrade a section of the
// wrap, never break the whole page.
async function readMonth(userId: string, periodMonth: string): Promise<RawMonth> {
  const { start, end } = monthBounds(periodMonth);
  const inMonth = (col: any) => and(gte(col, start), lt(col, end));

  const [messageRows, decisions, goalsClosed, actionRows, factRows] = await Promise.all([
    db.select({ createdAt: messagesTable.createdAt }).from(messagesTable)
      .where(and(eq(messagesTable.userId, userId), eq(messagesTable.role, "user"), inMonth(messagesTable.createdAt)))
      .catch(() => [] as { createdAt: Date | null }[]),
    db.select({
      query: venusDecisionsTable.query,
      recommendationSummary: venusDecisionsTable.recommendationSummary,
      status: venusDecisionsTable.status,
      decisionType: venusDecisionsTable.decisionType,
      lesson: venusDecisionsTable.lesson,
      createdAt: venusDecisionsTable.createdAt,
    }).from(venusDecisionsTable)
      .where(and(eq(venusDecisionsTable.sessionId, userId), inMonth(venusDecisionsTable.createdAt)))
      .orderBy(desc(venusDecisionsTable.createdAt))
      .catch(() => [] as RawMonth["decisions"]),
    db.select({ title: goalsTable.title, status: goalsTable.status }).from(goalsTable)
      .where(and(eq(goalsTable.userId, userId), inArray(goalsTable.status, ["completed", "abandoned"]), inMonth(goalsTable.resolvedAt)))
      .catch(() => [] as { title: string; status: string }[]),
    db.select({ id: queueItemsTable.id }).from(queueItemsTable)
      .where(and(eq(queueItemsTable.userId, userId), inArray(queueItemsTable.status, ["accepted", "edited"]), inMonth(queueItemsTable.resolvedAt)))
      .catch(() => [] as { id: number }[]),
    db.select({ id: companyFactsTable.id }).from(companyFactsTable)
      .where(and(eq(companyFactsTable.userId, userId), inMonth(companyFactsTable.createdAt)))
      .catch(() => [] as { id: number }[]),
  ]);

  return {
    messages: messageRows.length,
    decisions,
    goalsClosed,
    actionsTaken: actionRows.length,
    factsLearned: factRows.length,
    messageDates: messageRows.map((r) => r.createdAt),
  };
}

function busiestDayOf(dates: (Date | null)[]): { date: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const d of dates) {
    if (!d) continue;
    const key = new Date(d).toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: { date: string; count: number } | null = null;
  for (const [date, count] of counts) {
    if (!best || count > best.count) best = { date, count };
  }
  // A "busiest day" of one message is noise dressed as a finding.
  return best && best.count >= 3 ? best : null;
}

const NARRATIVE_SYSTEM_PROMPT = `You write a founder's monthly wrap for Asher — a short, sharp read on the month they just had, based ONLY on numbers computed from their actual activity.

Hard rules:
- Use ONLY the figures given to you. Never introduce a number, percentage, date, company or person that isn't in the input. If you want to say something you don't have a number for, say it qualitatively or don't say it.
- No congratulation-for-its-own-sake and no motivational filler. A founder can tell the difference between a real observation about their month and a greeting card, and the second one costs you all your credibility.
- If the month was quiet, say it was quiet. That is a legitimate, useful thing to report — a founder who barely used Asher should be told that plainly, not handed a fabricated highlight reel.
- Notice the SHAPE of the month, not just the totals: what they focused on, what changed against last month, what they started and didn't finish.
- Second person, plain language, short sentences. No emoji, no headings, no markdown.

Return ONLY this JSON:
{"headline": "one line, under 60 characters, specific to this month", "story": "2-4 sentences on what actually happened and what it suggests", "oneThingToChange": "one concrete, specific thing to do differently next month, grounded in the data above"}`;

async function writeNarrative(groq: Groq, wrap: Omit<MonthlyWrap, "narrative">): Promise<MonthlyWrap["narrative"]> {
  try {
    const statLines = wrap.stats
      .map((s) => `- ${s.label}: ${s.value}${s.previousValue != null ? ` (last month: ${s.previousValue}${s.changePct != null ? `, ${s.changePct >= 0 ? "+" : ""}${s.changePct}%` : ""})` : ""}`)
      .join("\n");
    const topicLines = wrap.topics.map((t) => `- ${t.topic}: ${t.count}`).join("\n") || "(no clear pattern)";
    const decisionLines = wrap.decisionsMade.slice(0, 6).map((d) => `- [${d.status}] ${d.query.slice(0, 120)}`).join("\n") || "(none)";
    const goalLines = wrap.goalsClosed.map((g) => `- ${g.title} (${g.status})`).join("\n") || "(none closed)";

    const { parsed } = await callGroqJSON(
      groq,
      {
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: NARRATIVE_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Month: ${wrap.monthLabel}\n\nNUMBERS:\n${statLines}\n\nWHAT THEY WORKED ON:\n${topicLines}\n\nDECISIONS LOGGED:\n${decisionLines}\n\nGOALS CLOSED:\n${goalLines}\n\nLESSONS THEY RECORDED:\n${wrap.lessons.map((l) => `- ${l}`).join("\n") || "(none)"}`,
          },
        ],
        temperature: 0.5,
        max_tokens: 700,
      },
      "monthlyWrap/narrative",
    );
    if (!parsed) return null;
    return {
      headline: typeof parsed.headline === "string" ? parsed.headline.trim().slice(0, 120) : "",
      story: typeof parsed.story === "string" ? parsed.story.trim() : "",
      oneThingToChange: typeof parsed.oneThingToChange === "string" ? parsed.oneThingToChange.trim() : "",
    };
  } catch (err) {
    // The wrap's numbers are the product; the narrative is a bonus on top.
    // A failed generation must never cost the founder the whole page.
    console.error("[monthlyWrap] narrative generation failed, returning wrap without it", err);
    return null;
  }
}

/**
 * Builds the wrap for one month. `groq` may be null (no key configured) — the
 * numbers still compute, only the narrative is skipped.
 */
export async function buildMonthlyWrap(userId: string, periodMonth: string, groq: Groq | null): Promise<MonthlyWrap> {
  const [current, previous] = await Promise.all([
    readMonth(userId, periodMonth),
    readMonth(userId, previousPeriod(periodMonth)),
  ]);

  const resolvedCount = current.decisions.filter((d) => d.status === "resolved").length;
  const prevResolvedCount = previous.decisions.filter((d) => d.status === "resolved").length;

  const stats: WrapStat[] = [
    { key: "questions", label: "Questions you brought to Asher", value: current.messages, previousValue: previous.messages, changePct: changePct(current.messages, previous.messages), unit: "count" },
    { key: "decisions", label: "Decisions logged", value: current.decisions.length, previousValue: previous.decisions.length, changePct: changePct(current.decisions.length, previous.decisions.length), unit: "count" },
    { key: "resolved", label: "Decisions you closed the loop on", value: resolvedCount, previousValue: prevResolvedCount, changePct: changePct(resolvedCount, prevResolvedCount), unit: "count" },
    { key: "actions", label: "Actions taken from your inbox", value: current.actionsTaken, previousValue: previous.actionsTaken, changePct: changePct(current.actionsTaken, previous.actionsTaken), unit: "count" },
    { key: "facts", label: "New things Asher learned about you", value: current.factsLearned, previousValue: previous.factsLearned, changePct: changePct(current.factsLearned, previous.factsLearned), unit: "count" },
  ];

  const topicCounts = new Map<string, number>();
  for (const d of current.decisions) {
    if (!d.decisionType) continue;
    topicCounts.set(d.decisionType, (topicCounts.get(d.decisionType) ?? 0) + 1);
  }
  const topics = [...topicCounts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const base: Omit<MonthlyWrap, "narrative"> = {
    periodMonth,
    monthLabel: monthLabel(periodMonth),
    // One question and nothing else is not a month worth wrapping. The
    // threshold is deliberately low but non-zero: the alternative is a page
    // of zeroes with a generated story about them, which is precisely the
    // fabricated-highlight-reel failure this file exists to avoid.
    hasSignal: current.messages >= 3 || current.decisions.length >= 1 || current.actionsTaken >= 1,
    stats,
    topics,
    decisionsMade: current.decisions.slice(0, 8).map((d) => ({
      query: d.query,
      recommendation: d.recommendationSummary,
      status: d.status,
    })),
    goalsClosed: current.goalsClosed,
    lessons: current.decisions.map((d) => d.lesson).filter((l): l is string => Boolean(l)).slice(0, 5),
    busiestDay: busiestDayOf(current.messageDates),
  };

  const narrative = base.hasSignal && groq ? await writeNarrative(groq, base) : null;
  return { ...base, narrative };
}

/**
 * Persists the computed wrap so the numbers a founder saw stay frozen rather
 * than silently drifting when they reopen it later. Idempotent per
 * (userId, periodMonth) — the daily job may run more than once.
 */
export async function persistMonthlyWrap(userId: string, wrap: MonthlyWrap): Promise<void> {
  try {
    await db
      .insert(monthlyRecapsTable)
      .values({ userId, periodMonth: wrap.periodMonth, dataJson: JSON.stringify(wrap) })
      .onConflictDoNothing({ target: [monthlyRecapsTable.userId, monthlyRecapsTable.periodMonth] });
  } catch (err) {
    console.error("[monthlyWrap] failed to persist", err);
  }
}
