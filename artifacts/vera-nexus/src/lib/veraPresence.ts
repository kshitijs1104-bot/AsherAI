import { getSessions } from './venusHistory';

/* ---------------------------------------------------------------------------
   VERA NOTICING THINGS — a personality made of facts, not moods.

   The idea being implemented: a product that needs something back from you,
   and reacts when you go quiet, is treated by the brain as a relationship
   rather than software. The danger in implementing it is that "give the app a
   personality" almost always ships as a mascot with canned enthusiasm, and a
   business tool that greets a founder with "Welcome back, superstar!" has made
   itself embarrassing to have open in a meeting.

   So the rule here: EVERY LINE MUST BE ABOUT SOMETHING THAT ACTUALLY HAPPENED,
   and Vera must be the one who noticed it. "You were away eleven days" is a
   fact, and noticing it is what a person who was paying attention would do.
   "We missed you!" is a mood, and it is what a product with nothing to say
   does instead.

   THREE MOMENTS, deliberately — this is the whole set, and it should stay
   small. Each fires at most once per day, and only when its fact is true:

     RETURN AFTER ABSENCE — noticed once, factually, with the gap named. This
     is the moment the "relationship" framing is actually earned: somebody who
     was paying attention would say something, and somebody who was not would
     open a blank page.

     A KEPT RUN — acknowledged ONCE at meaningful milestones, never every day.
     Congratulating somebody daily for a habit is how the acknowledgement stops
     being worth anything.

     WORK LEFT MID-WAY — the most useful of the three, and the least like a
     personality: it names the thread they abandoned so they can pick it up.

   WHAT IS DELIBERATELY ABSENT: no emoji, no exclamation marks, no praise for
   using the product, no "I" claiming feelings Vera does not have. Vera notices
   and says what it noticed. That is the entire personality, and it is the one
   that survives being read by a serious person on a bad day.

   All of this is computed from local session history — no new endpoint, no new
   table. The facts it needs are already on the device.
--------------------------------------------------------------------------- */

const LAST_SEEN_KEY = 've_last_seen';
const GREETED_ON_KEY = 've_greeted_on';

export interface PresenceNote {
  /** Stable identifier so a caller can key a render on it. */
  kind: 'return' | 'streak' | 'unfinished';
  text: string;
}

function todayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function readLastSeen(): Date | null {
  try {
    const raw = localStorage.getItem(LAST_SEEN_KEY);
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

/** Called once per app open, AFTER the note has been computed — otherwise the
 *  gap would always read as zero and the return moment could never fire. */
export function recordSeen(now = new Date()): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, now.toISOString());
  } catch {}
}

function alreadyGreetedToday(now: Date): boolean {
  try {
    return localStorage.getItem(GREETED_ON_KEY) === todayKey(now);
  } catch {
    return true; // storage blocked — say nothing rather than repeat on every render
  }
}

function markGreetedToday(now: Date): void {
  try {
    localStorage.setItem(GREETED_ON_KEY, todayKey(now));
  } catch {}
}

function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

/**
 * The one thing worth saying right now, or null when there is nothing — which
 * is the common case and the correct one. A product that always has a remark
 * is a product whose remarks mean nothing.
 *
 * @param streak the founder's current queue streak, so the milestone note
 *   agrees with the number the board is showing rather than computing a second
 *   one that could disagree.
 */
export function getPresenceNote(streak = 0, now = new Date()): PresenceNote | null {
  if (alreadyGreetedToday(now)) return null;

  const lastSeen = readLastSeen();

  // First ever open: say nothing. A greeting to somebody who has never been
  // here has nothing to notice, and the seeded first conversation (see
  // takePendingSeedMessage) is already carrying that moment.
  if (!lastSeen) {
    markGreetedToday(now);
    return null;
  }

  const gap = daysBetween(lastSeen, now);

  // ---- Returned after a real absence ----
  // Four days is the threshold: shorter than that is a weekend or a busy
  // stretch, and remarking on it would be the product being clingy about
  // nothing.
  if (gap >= 4) {
    markGreetedToday(now);
    const unfinished = countUnfinishedThreads();
    return {
      kind: 'return',
      text:
        unfinished > 0
          ? `It's been ${gap} days. You left ${unfinished === 1 ? 'a conversation' : `${unfinished} conversations`} unfinished — everything's still here.`
          : `It's been ${gap} days. Everything's still here.`,
    };
  }

  // ---- A run worth acknowledging, once ----
  // Milestones only. Saying something every day turns the acknowledgement into
  // wallpaper, and then the day it genuinely matters it reads the same as all
  // the others.
  if (streak === 3 || streak === 7 || streak === 14 || streak === 30 || (streak > 30 && streak % 30 === 0)) {
    markGreetedToday(now);
    return { kind: 'streak', text: `${streak} days running. That's the part most people don't do.` };
  }

  // ---- Something left mid-way ----
  const unfinished = countUnfinishedThreads();
  if (unfinished > 0) {
    markGreetedToday(now);
    return {
      kind: 'unfinished',
      text:
        unfinished === 1
          ? 'You left a question hanging last time. It\'s still open.'
          : `${unfinished} conversations are still open from last time.`,
    };
  }

  markGreetedToday(now);
  return null;
}

/** A thread whose last message is the founder's own — asked, never answered.
 *  The same definition the server's nudge engine uses, so the two agree. */
function countUnfinishedThreads(): number {
  try {
    return getSessions().filter((s) => {
      const last = s.messages[s.messages.length - 1];
      return last?.role === 'user';
    }).length;
  } catch {
    return 0;
  }
}

/** Test/debug hook — lets the return moment be exercised without waiting days. */
export function __setLastSeen(iso: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, iso);
    localStorage.removeItem(GREETED_ON_KEY);
  } catch {}
}
