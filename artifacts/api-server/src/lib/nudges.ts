import {
  db,
  nudgeStateTable,
  companyDossiersTable,
  queueItemsTable,
  chatsTable,
  messagesTable,
  goalsTable,
  settingsTable,
  usageDailyTable,
} from "@workspace/db";
import { and, desc, eq, gte, or, sql, count } from "drizzle-orm";
import { logger } from "./logger";

/* ---------------------------------------------------------------------------
   NUDGES — the reason to come back, derived from what is actually true.

   THE RULE THIS FILE IS BUILT AROUND: a nudge must name something REAL and
   UNFINISHED, belonging to this founder, that they could act on in the next
   minute. Everything else is a notification badge for its own sake, and a
   product that interrupts people with nothing behind it teaches them to
   ignore the one interruption that mattered.

   So nudges are DERIVED on every read, never stored. "You have 4 unanswered
   questions in your dossier" is recomputed from the dossier each time — a
   stored copy would keep saying it after they finished, which is the exact
   thing that makes notification systems feel broken and dishonest.

   What IS stored (nudge_state) is only the part derivation cannot know:
   whether this person has already been told, whether they said no, and how
   many times we have asked. See that table's header for why.

   THREE THINGS THAT KEEP THIS HONEST, all enforced below rather than left to
   whoever adds the next nudge:

     COOLDOWN — nothing is shown again within NUDGE_COOLDOWN_MS. Three hours,
     which is the cadence asked for, and is also roughly "twice in a working
     day" rather than "every time you glance at the tab".

     A CEILING — a nudge that has been shown MAX_SHOWS times without being
     acted on stops. Silence is the correct end state for a suggestion the
     founder has ignored six times; continuing is nagging, and it costs the
     credibility of everything else in the badge.

     DISMISSAL IS PERMANENT — "not interested" does not expire and come back
     after the cooldown. A dismissal that returns is not a dismissal.

   NOTHING HERE INVENTS URGENCY. There are no countdown timers on things that
   do not expire, and no "act now" on a decision that can wait — the honest
   pull is that the work is genuinely sitting there unfinished.
--------------------------------------------------------------------------- */

/** How long before the same nudge may be shown again. */
export const NUDGE_COOLDOWN_MS = 3 * 60 * 60 * 1000;

/** After this many unacted showings, a nudge gives up rather than nagging. */
const MAX_SHOWS = 6;

export type NudgePriority = "high" | "normal" | "low";

export interface Nudge {
  /** Stable slug, and the key nudge_state records against. */
  kind: string;
  title: string;
  /** One sentence. Says what is unfinished, never how the founder should feel. */
  body: string;
  /** In-app route this resolves at. The nudge is only useful if it lands
   *  somewhere the thing can actually be done. */
  href: string;
  /** Label for the action, written as the verb the founder is about to do. */
  actionLabel: string;
  priority: NudgePriority;
}

/* -------------------------------------------------------------------------
 * Deriving candidates from real state
 * ---------------------------------------------------------------------- */

function countUnansweredDossierFields(questionsJson: string, answersJson: string): number {
  try {
    const questions = JSON.parse(questionsJson) as { id?: string }[];
    const answers = JSON.parse(answersJson) as Record<string, unknown>;
    if (!Array.isArray(questions)) return 0;
    return questions.filter((q) => {
      const id = q?.id;
      if (!id) return false;
      const a = answers?.[id];
      return a === undefined || a === null || (typeof a === "string" && a.trim() === "");
    }).length;
  } catch {
    // Malformed JSON means we cannot honestly claim a number, so we claim none
    // rather than guessing one onto a founder's screen.
    return 0;
  }
}

/**
 * Everything Vera could truthfully prompt this founder about right now,
 * before cooldown/dismissal filtering. Ordered by how much the founder
 * probably cares, not by how much the product wants the click.
 *
 * Every query here is scoped to userId. Best-effort throughout: one failing
 * signal must not cost the founder the rest of their nudges, so each is
 * wrapped and a failure yields no nudge of that kind rather than an error.
 */
async function deriveCandidates(userId: string, now: Date): Promise<Nudge[]> {
  const candidates: Nudge[] = [];
  const todayKey = now.toISOString().slice(0, 10);

  const [dossier, pendingQueue, staleThread, activeGoals, settings, todayUsage, actedToday] = await Promise.all([
    db
      .select({
        id: companyDossiersTable.id,
        questionsJson: companyDossiersTable.questionsJson,
        answersJson: companyDossiersTable.answersJson,
      })
      .from(companyDossiersTable)
      .where(eq(companyDossiersTable.userId, userId))
      .orderBy(desc(companyDossiersTable.id))
      .limit(1)
      .catch(() => []),

    db
      .select({ n: count() })
      .from(queueItemsTable)
      .where(and(eq(queueItemsTable.userId, userId), eq(queueItemsTable.status, "pending")))
      .catch(() => [{ n: 0 }]),

    // A chat whose LAST message is the founder's own — they asked something
    // and never got back to the answer, or the turn failed. This is the most
    // genuinely useful nudge in the set because it points at abandoned work
    // rather than at an untouched feature.
    db
      .select({ chatId: messagesTable.chatId, role: messagesTable.role, createdAt: messagesTable.createdAt })
      .from(messagesTable)
      .where(eq(messagesTable.userId, userId))
      .orderBy(desc(messagesTable.createdAt))
      .limit(1)
      .catch(() => []),

    db
      .select({ n: count() })
      .from(goalsTable)
      .where(and(eq(goalsTable.userId, userId), eq(goalsTable.status, "active")))
      .catch(() => [{ n: 0 }]),

    db
      .select({
        onboardingCompleted: settingsTable.onboardingCompleted,
        companyName: settingsTable.companyName,
      })
      .from(settingsTable)
      .where(eq(settingsTable.sessionId, userId))
      .limit(1)
      .catch(() => []),

    db
      .select({ spent: usageDailyTable.spent, cooldownUntil: usageDailyTable.cooldownUntil })
      .from(usageDailyTable)
      .where(and(or(eq(usageDailyTable.subject, userId), eq(usageDailyTable.subject, `u:${userId}`)), eq(usageDailyTable.day, todayKey)))
      .limit(1)
      .catch(() => []),

    // Did they act on the board today? Drives the streak-at-risk nudge below.
    db
      .select({ n: count() })
      .from(queueItemsTable)
      .where(
        and(
          eq(queueItemsTable.userId, userId),
          gte(queueItemsTable.resolvedAt, new Date(`${todayKey}T00:00:00.000Z`)),
        ),
      )
      .catch(() => [{ n: 0 }]),
  ]);

  // ---- Onboarding never finished ----
  //
  // "Completed" is onboardingCompleted OR a company name being on file, and the
  // second half is not redundant — it is the fix for a live bug.
  //
  // The flag is only set by POST /profile/onboarding, which did not exist until
  // recently. Every account created before it, and every account whose write
  // failed (the columns not yet existing on that environment being the reported
  // case), has the flag false while plainly having completed the form. Those
  // founders were told to "finish setup" they had already finished, on every
  // load, with no way to make it stop.
  //
  // A company name can only get into that column by way of the onboarding form
  // or the account card, so its presence is direct evidence the founder has
  // told Vera who they are — which is the thing this nudge actually wants to
  // know. Checking the evidence rather than the bookkeeping flag makes the
  // nudge correct for accounts that predate the flag entirely.
  const s = settings[0];
  const hasToldVeraWhoTheyAre = !!s?.onboardingCompleted || !!s?.companyName?.trim();
  if (s && !hasToldVeraWhoTheyAre) {
    candidates.push({
      kind: "onboarding.incomplete",
      title: "Tell Vera who you are",
      body: "Vera calibrates every answer to your company and stage. Right now it's working without that.",
      href: "/enterprise/onboarding",
      actionLabel: "Finish setup",
      priority: "high",
    });
  }

  // ---- Dossier ----
  const d = dossier[0];
  if (!d) {
    candidates.push({
      kind: "dossier.missing",
      title: "Vera doesn't have a company file yet",
      body: "The dossier is what makes Vera's answers about your business instead of businesses in general.",
      href: "/vera/dossier",
      actionLabel: "Start the dossier",
      priority: "high",
    });
  } else {
    const unanswered = countUnansweredDossierFields(d.questionsJson, d.answersJson);
    if (unanswered > 0) {
      candidates.push({
        kind: "dossier.incomplete",
        title: `${unanswered} thing${unanswered === 1 ? "" : "s"} Vera still doesn't know`,
        body: "Each one it can't answer is a gap it has to guess around. They take a sentence each.",
        href: "/vera/dossier",
        actionLabel: "Fill them in",
        priority: "normal",
      });
    }
  }

  // ---- Unfinished thread ----
  const last = staleThread[0];
  if (last && last.role === "user" && last.chatId && last.createdAt) {
    const ageMs = now.getTime() - new Date(last.createdAt).getTime();
    // Only once it is genuinely stale. A message sent four minutes ago is a
    // conversation in progress, not something abandoned, and nudging about it
    // would be the product interrupting a founder who is already using it.
    if (ageMs > 45 * 60 * 1000) {
      candidates.push({
        kind: "chat.unfinished",
        title: "You left a question hanging",
        body: "Your last message never got an answer. Reopen it and Vera will pick it back up.",
        href: "/vera",
        actionLabel: "Reopen it",
        priority: "high",
      });
    }
  }

  // ---- Board ----
  const pending = pendingQueue[0]?.n ?? 0;
  if (pending > 0) {
    candidates.push({
      kind: "queue.pending",
      title: `${pending} item${pending === 1 ? "" : "s"} waiting on you`,
      body: "Vera drafted or found these. They stay pending until you accept, edit or reject them.",
      href: "/vera?view=command-center",
      actionLabel: "Open the board",
      priority: "normal",
    });
  }

  // ---- Streak at risk. The one loss-framed nudge, and it is honest: ----
  // it only fires when a real streak exists and today would break it.
  const actionsToday = actedToday[0]?.n ?? 0;
  if (pending > 0 && actionsToday === 0) {
    const streak = await currentQueueStreak(userId).catch(() => 0);
    if (streak > 0) {
      candidates.push({
        kind: "streak.at_risk",
        title: `Your ${streak}-day streak ends tonight`,
        body: "One item off the board keeps it. Nothing today and it goes back to zero.",
        href: "/vera?view=command-center",
        actionLabel: "Keep the streak",
        priority: "high",
      });
    }
  }

  // ---- No goal ----
  if ((activeGoals[0]?.n ?? 0) === 0) {
    candidates.push({
      kind: "goal.none",
      title: "No goal set",
      body: "With a goal, Vera weighs advice against what you're actually trying to hit. Without one it can only answer in general.",
      href: "/vera/goals",
      actionLabel: "Set a goal",
      priority: "low",
    });
  }

  // ---- Cooldown has ended ----
  const usage = todayUsage[0];
  if (usage?.cooldownUntil && new Date(usage.cooldownUntil).getTime() <= now.getTime()) {
    candidates.push({
      kind: "usage.cooldown_ended",
      title: "You're back to full analyses",
      body: "You hit the daily cap earlier. The cooldown has passed — pick up whatever you stopped on.",
      href: "/vera",
      actionLabel: "Carry on",
      priority: "normal",
    });
  }

  return candidates;
}

/** Consecutive days ending today/yesterday with a resolved queue item. Mirrors
 *  computeQueueStreak in dailyBrief.ts — same definition, so the streak the
 *  nudge threatens is exactly the streak the board displays. */
async function currentQueueStreak(userId: string): Promise<number> {
  const rows = await db
    .select({ resolvedAt: queueItemsTable.resolvedAt })
    .from(queueItemsTable)
    .where(eq(queueItemsTable.userId, userId))
    .orderBy(desc(queueItemsTable.resolvedAt))
    .limit(400);

  const activeDays = new Set(
    rows.map((r) => r.resolvedAt).filter((d): d is Date => !!d).map((d) => new Date(d).toISOString().slice(0, 10)),
  );
  if (activeDays.size === 0) return 0;

  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  if (!activeDays.has(cursor.toISOString().slice(0, 10))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (!activeDays.has(cursor.toISOString().slice(0, 10))) return 0;
  }

  let streak = 0;
  while (activeDays.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

/* -------------------------------------------------------------------------
 * Filtering against what has already been said
 * ---------------------------------------------------------------------- */

const PRIORITY_ORDER: Record<NudgePriority, number> = { high: 0, normal: 1, low: 2 };

/**
 * The nudges this founder should actually see right now.
 *
 * @param limit how many to return. Deliberately small by default — a list of
 *   nine things you haven't done is a guilt trip, not a prompt, and nobody
 *   acts on it.
 */
export async function getNudgesFor(userId: string, now = new Date(), limit = 3): Promise<Nudge[]> {
  const candidates = await deriveCandidates(userId, now);
  if (candidates.length === 0) return [];

  let state: { kind: string; lastShownAt: Date | null; shownCount: number; dismissedAt: Date | null }[] = [];
  try {
    state = await db
      .select({
        kind: nudgeStateTable.kind,
        lastShownAt: nudgeStateTable.lastShownAt,
        shownCount: nudgeStateTable.shownCount,
        dismissedAt: nudgeStateTable.dismissedAt,
      })
      .from(nudgeStateTable)
      .where(eq(nudgeStateTable.userId, userId));
  } catch (err) {
    // Fails OPEN — showing a nudge slightly too often is a much smaller harm
    // than showing none at all because a bookkeeping table was unreachable.
    logger.error({ err, userId }, "Nudge state read failed — proceeding without cooldown filtering");
  }

  const byKind = new Map(state.map((s) => [s.kind, s]));

  return candidates
    .filter((n) => {
      const s = byKind.get(n.kind);
      if (!s) return true;
      if (s.dismissedAt) return false;
      if (s.shownCount >= MAX_SHOWS) return false;
      if (s.lastShownAt && now.getTime() - new Date(s.lastShownAt).getTime() < NUDGE_COOLDOWN_MS) return false;
      return true;
    })
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    .slice(0, limit);
}

/**
 * Records that these kinds were put in front of the founder. Called only when
 * they were genuinely RENDERED, not when they were computed — otherwise a
 * background poll would burn the cooldown and the ceiling on nudges nobody
 * ever saw, and the founder would be silently used up.
 */
export async function markNudgesShown(userId: string, kinds: string[], now = new Date()): Promise<void> {
  if (kinds.length === 0) return;
  try {
    for (const kind of kinds) {
      await db
        .insert(nudgeStateTable)
        .values({ userId, kind, lastShownAt: now, shownCount: 1 })
        .onConflictDoUpdate({
          target: [nudgeStateTable.userId, nudgeStateTable.kind],
          set: {
            lastShownAt: now,
            // Incremented in SQL rather than from a value read earlier, so two
            // concurrent renders both count instead of one overwriting the other.
            shownCount: sql`${nudgeStateTable.shownCount} + 1`,
            updatedAt: now,
          },
        });
    }
  } catch (err) {
    logger.error({ err, userId }, "Could not record nudges as shown");
  }
}

/** Permanent, by design — see the header. */
export async function dismissNudge(userId: string, kind: string, now = new Date()): Promise<void> {
  await db
    .insert(nudgeStateTable)
    .values({ userId, kind, dismissedAt: now })
    .onConflictDoUpdate({
      target: [nudgeStateTable.userId, nudgeStateTable.kind],
      set: { dismissedAt: now, updatedAt: now },
    });
}
