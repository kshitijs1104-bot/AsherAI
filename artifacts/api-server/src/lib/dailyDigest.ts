import { db, queueItemsTable, goalsTable, chatsTable } from "@workspace/db";
import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import { logger } from "./logger";

/* ---------------------------------------------------------------------------
   THE DAILY PULL-BACK

   What this is for: the Command Centre only had things in it if a founder had
   already been using Vera, which is backwards — the board is supposed to be the
   reason to come back, not a reward for having come back. This builds one item a
   day per founder and (optionally) emails it, so there is a reason to open Vera
   on a day they weren't already planning to.

   TWO RULES THAT KEEP THIS FROM BECOMING SPAM, both learned from what this
   codebase already deleted once. The queue used to be seeded with three
   fabricated rows — a drafted reply to a customer who didn't exist, a revenue
   reading off a sheet nobody had connected — and they were removed because a
   founder's first impression was three pieces of fiction they had to clear by
   hand. The same trap is wide open for a daily notification, so:

     1. NEVER INVENT WORK. Every number in a digest is counted from rows that
        already exist. If there is nothing real to report, `hasSignal` is false
        and NOTHING is created — no item, no email. A quiet day gets silence,
        not a manufactured nudge. This is the rule that decides whether the
        feature is useful or is the thing that gets Vera muted.

     2. ONE PER DAY, MAX. The item's externalId is the UTC date, and
        queue_items already has a unique index on (userId, source, externalId),
        so a second run on the same day is a no-op at the database level rather
        than something this code has to remember not to do. Re-running the job
        after a failure is therefore always safe.
--------------------------------------------------------------------------- */

export interface DailyDigest {
  /** Whether there is anything worth telling the founder about at all. */
  hasSignal: boolean;
  /** Items waiting on the board right now. */
  pending: number;
  /** Items that arrived since the last digest ran. */
  arrivedSinceYesterday: number;
  /** Goals still open — the thing most worth a nudge when the board is quiet. */
  activeGoals: number;
  /** Goals whose deadline is inside a week. */
  goalsDueSoon: number;
  /** One line, already written, safe to use as an email subject or item body. */
  headline: string;
  body: string;
}

const DIGEST_SOURCE = "vera";

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Everything the digest says, counted — never inferred, never invented. */
export async function buildDailyDigest(userId: string, now = new Date()): Promise<DailyDigest> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [pendingRows, freshRows, goalRows, dueRows, chatRows] = await Promise.all([
    db
      .select({ n: count() })
      .from(queueItemsTable)
      .where(and(eq(queueItemsTable.userId, userId), eq(queueItemsTable.status, "pending"))),
    db
      .select({ n: count() })
      .from(queueItemsTable)
      .where(and(eq(queueItemsTable.userId, userId), gte(queueItemsTable.createdAt, dayAgo))),
    db
      .select({ n: count() })
      .from(goalsTable)
      .where(and(eq(goalsTable.userId, userId), eq(goalsTable.status, "active"))),
    db
      .select({ n: count() })
      .from(goalsTable)
      .where(
        and(
          eq(goalsTable.userId, userId),
          eq(goalsTable.status, "active"),
          sql`${goalsTable.deadline} <= ${weekAhead.toISOString()}`,
        ),
      ),
    db.select({ n: count() }).from(chatsTable).where(eq(chatsTable.userId, userId)),
  ]);

  const pending = pendingRows[0]?.n ?? 0;
  const arrivedSinceYesterday = freshRows[0]?.n ?? 0;
  const activeGoals = goalRows[0]?.n ?? 0;
  const goalsDueSoon = dueRows[0]?.n ?? 0;
  const chats = chatRows[0]?.n ?? 0;

  // Rule 1. Something real has to be true before a founder's attention is
  // spent. A brand-new account with nothing in it is the one case where a
  // nudge IS warranted, because the useful next step is concrete (connect
  // something) rather than invented — but only while they have no chats at
  // all, so it fires once at the start and never again.
  const isBrandNew = chats === 0 && pending <= 1 && activeGoals === 0;
  const hasSignal = pending > 0 || arrivedSinceYesterday > 0 || goalsDueSoon > 0 || isBrandNew;

  return {
    hasSignal,
    pending,
    arrivedSinceYesterday,
    activeGoals,
    goalsDueSoon,
    ...writeLines({ pending, arrivedSinceYesterday, goalsDueSoon, activeGoals, isBrandNew }),
  };
}

// Written from the counts, in priority order: what's new, then what's waiting,
// then what's nearly due. Deliberately plain — a subject line that oversells
// ("Your business needs attention!") is the other way this feature gets muted.
function writeLines(d: {
  pending: number;
  arrivedSinceYesterday: number;
  goalsDueSoon: number;
  activeGoals: number;
  isBrandNew: boolean;
}): { headline: string; body: string } {
  if (d.isBrandNew) {
    return {
      headline: "Connect something and Vera starts working in the background",
      body: "Your board is empty because nothing is connected yet. Link Gmail, Slack, Calendar or Jira and Vera starts pulling what needs your attention into one place — drafts ready to send, deadlines coming up, threads waiting on you.",
    };
  }

  const parts: string[] = [];
  if (d.arrivedSinceYesterday > 0) {
    parts.push(`${d.arrivedSinceYesterday} new since yesterday`);
  }
  if (d.pending > 0) {
    parts.push(`${d.pending} waiting on you`);
  }
  if (d.goalsDueSoon > 0) {
    parts.push(`${d.goalsDueSoon} ${d.goalsDueSoon === 1 ? "goal" : "goals"} due within the week`);
  }

  const headline = parts.length > 0 ? `Today: ${parts.join(", ")}` : "Your board is clear";

  const bodyBits: string[] = [];
  if (d.arrivedSinceYesterday > 0) {
    bodyBits.push(
      `${d.arrivedSinceYesterday} ${d.arrivedSinceYesterday === 1 ? "item" : "items"} came in since yesterday.`,
    );
  }
  if (d.pending > 0) {
    bodyBits.push(`${d.pending} ${d.pending === 1 ? "item is" : "items are"} still waiting for a decision.`);
  }
  if (d.goalsDueSoon > 0) {
    bodyBits.push(
      `${d.goalsDueSoon} of your ${d.activeGoals} active ${d.activeGoals === 1 ? "goal" : "goals"} ${d.goalsDueSoon === 1 ? "has a deadline" : "have deadlines"} inside the next week.`,
    );
  }

  return { headline, body: bodyBits.join(" ") };
}

/**
 * Puts the digest on the board as a queue item, once per UTC day.
 *
 * Returns true only when a row was actually created — the caller uses that to
 * decide whether to send an email, so a day that was already covered never
 * emails twice even if the job runs repeatedly.
 */
export async function ensureDailyBriefItem(userId: string, digest: DailyDigest, now = new Date()): Promise<boolean> {
  if (!digest.hasSignal) return false;

  const externalId = `brief:${utcDay(now)}`;

  try {
    // Rule 2. The unique index on (userId, source, externalId) is what makes
    // this idempotent, so re-running the job is safe by construction rather
    // than by this function checking first and racing with itself.
    const inserted = await db
      .insert(queueItemsTable)
      .values({
        userId,
        type: "daily_brief",
        source: DIGEST_SOURCE,
        title: digest.headline,
        body: digest.body,
        externalId,
        draftContent: null,
      })
      .onConflictDoNothing({
        target: [queueItemsTable.userId, queueItemsTable.source, queueItemsTable.externalId],
      })
      .returning({ id: queueItemsTable.id });

    return inserted.length > 0;
  } catch (err) {
    logger.error({ err, userId }, "Could not create the daily brief item");
    return false;
  }
}

/** Unread count for the notification dot — pending items never put on screen. */
export async function countUnseen(userId: string): Promise<number> {
  try {
    const [row] = await db
      .select({ n: count() })
      .from(queueItemsTable)
      .where(and(eq(queueItemsTable.userId, userId), eq(queueItemsTable.status, "pending"), isNull(queueItemsTable.seenAt)));
    return row?.n ?? 0;
  } catch (err) {
    // A failed count must not break the board it decorates.
    logger.error({ err, userId }, "Unseen count failed");
    return 0;
  }
}

/** Marks everything currently pending as seen — called when the board opens. */
export async function markQueueSeen(userId: string): Promise<number> {
  const updated = await db
    .update(queueItemsTable)
    .set({ seenAt: new Date() })
    .where(and(eq(queueItemsTable.userId, userId), isNull(queueItemsTable.seenAt)))
    .returning({ id: queueItemsTable.id });
  return updated.length;
}

/* -------------------------------------------------------------------------
 * Email
 *
 * Over Resend's REST API with fetch, rather than adding an SDK — same
 * reasoning as lib/storage.ts's Supabase driver: it keeps the dependency count
 * flat, keeps the esbuild bundle small, and avoids the workspace's one-day
 * minimum-release-age rule on new packages. Swapping to Postmark or SES means
 * changing this one function.
 *
 * ENTIRELY OPTIONAL. With RESEND_API_KEY unset this is a no-op that logs once,
 * and the in-app item still appears — so the feature degrades to "board only"
 * rather than failing. Vera sends no other email (Clerk handles auth mail), so
 * this is the only outbound sender in the product.
 * ---------------------------------------------------------------------- */

const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim() ?? "";
const DIGEST_FROM = process.env.DIGEST_FROM_EMAIL?.trim() ?? "";
const APP_URL = process.env.FRONTEND_URL?.trim() ?? "";

export function emailConfigured(): boolean {
  return !!RESEND_API_KEY && !!DIGEST_FROM;
}

export async function sendDigestEmail(to: string, digest: DailyDigest): Promise<boolean> {
  if (!emailConfigured()) return false;

  const boardUrl = `${APP_URL}/vera?view=command-center`;

  // Plain text alongside HTML: a digest that only renders as HTML lands in
  // spam more often, and this content is short enough that the text version is
  // genuinely readable rather than a courtesy.
  const text = `${digest.headline}\n\n${digest.body}\n\nOpen your board: ${boardUrl}\n\nTo stop these, turn off daily email in Vera → Settings.`;

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#16191f;line-height:1.6">
  <p style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#757d8c;margin:0 0 14px">Vera · Daily brief</p>
  <h1 style="font-size:19px;margin:0 0 10px;line-height:1.3">${escapeHtml(digest.headline)}</h1>
  <p style="margin:0 0 20px;color:#4a515e">${escapeHtml(digest.body)}</p>
  <a href="${escapeHtml(boardUrl)}" style="display:inline-block;background:#2f4c8c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">Open your board</a>
  <p style="font-size:12px;color:#757d8c;margin:24px 0 0">To stop these, turn off daily email in Vera → Settings.</p>
</div>`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: DIGEST_FROM, to, subject: digest.headline, html, text }),
    });

    if (!response.ok) {
      // Body is logged but never surfaced anywhere a user can see: provider
      // error bodies carry request ids and routing detail.
      const detail = await response.text().catch(() => "");
      logger.error({ status: response.status, detail: detail.slice(0, 300) }, "Digest email rejected by the provider");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, "Digest email could not be sent");
    return false;
  }
}

// The digest is built from counts, so it contains no user-authored text today —
// but it is going into an HTML email, and the day someone adds a chat title or
// a sender name to a headline is the day that stops being true. Escaping now
// costs nothing and means that change cannot become an injection.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
