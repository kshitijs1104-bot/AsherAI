import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger";

// ---- The free plan's usage ceiling ----
//
// WHY THIS IS NOT `express-rate-limit`. Everything else in app.ts is, and
// should stay that way — but this rule has semantics its fixed-window model
// cannot express. express-rate-limit starts a window at the FIRST request in
// it, so "250 per 5 hours" means someone who spends 1 call at 09:00 and the
// remaining 249 at 13:50 is free again at 14:00, ten minutes after hitting the
// cap. The rule here is a COOLDOWN: the clock starts when the budget runs out,
// not when it started being spent, so the wait is always the full five hours
// however the calls were distributed. That difference is the whole point of a
// cooldown, so it is written out rather than approximated.
//
// THE SHAPE, stated plainly because a usage limit that surprises a paying-
// adjacent user is worse than a slightly looser one:
//
//   - Every user gets DAILY_CALL_BUDGET model calls.
//   - Spending the last one starts a COOLDOWN_MS lockout, timed from that
//     moment. Requests during it are refused with the real time remaining.
//   - When the cooldown ends the budget resets in full.
//   - A budget that is never exhausted also expires on its own after
//     BUDGET_WINDOW_MS, so someone who uses 30 calls a day forever is never
//     creeping toward a cap they can't see.
//
// WORST CASE, SAID OUT LOUD: because the cooldown is what refills the budget,
// somebody deliberately maxing out gets 250 calls every 5 hours — up to about
// 1,200 in a day, not 250. That is the arithmetic of "cap then cooldown" and
// it is still ~36x tighter than the 43,200/day the per-minute limiter allowed
// on its own. If a hard 250-per-rolling-24h is wanted instead, make
// COOLDOWN_MS equal BUDGET_WINDOW_MS (24h) — one line, and the only thing that
// changes is that an exhausted user waits until tomorrow rather than for five
// hours.
//
// PLAN AWARENESS: there is no plan column yet — /enterprise/plan's tiers are
// display copy and the server enforces none of them (see LAUNCH_CHECKLIST §10).
// So this applies to everyone, which is correct while everyone is on the free
// plan. When paid plans land, `budgetFor(req)` is the seam: read the user's
// plan and return its numbers. Deliberately left as one function rather than
// threaded through the middleware so that change touches one place.

const DAILY_CALL_BUDGET = 250;
const COOLDOWN_MS = 5 * 60 * 60 * 1000;
const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

interface Bucket {
  /** Calls spent in the current budget window. */
  spent: number;
  /** When the current budget window expires and `spent` resets to 0. */
  windowEndsAt: number;
  /** Set only while locked out; epoch ms at which the cooldown ends. */
  cooldownUntil: number | null;
}

// In-memory, same tradeoff the other limiters make and worth restating: this
// counts PER PROCESS, so on autoscale the real ceiling is the budget times the
// number of instances, and a redeploy clears every bucket. That is a genuine
// weakening — it is accepted here because the alternative (a shared store, or
// a usage_daily row) is real infrastructure, and this bounds the runaway case
// by orders of magnitude either way. It is item 4 of the "not fixable from
// code" list in LAUNCH_CHECKLIST §10 for when that stops being good enough.
//
// Bounded so a stream of unauthenticated IPs can't grow it without limit — an
// abuse control that is itself a memory-exhaustion vector is not a control.
const MAX_TRACKED_KEYS = 50_000;
const buckets = new Map<string, Bucket>();

function sweep(now: number) {
  if (buckets.size < MAX_TRACKED_KEYS) return;
  for (const [key, b] of buckets) {
    const idle = (b.cooldownUntil ?? 0) < now && b.windowEndsAt < now;
    if (idle) buckets.delete(key);
  }
  // Still full of live buckets: drop the oldest insertions rather than refuse
  // service. Map iterates in insertion order, so this evicts the least
  // recently created. An evicted user gets a fresh budget, which is the safe
  // direction for THIS failure — losing a limit is recoverable, wrongly
  // locking out every user is not.
  if (buckets.size >= MAX_TRACKED_KEYS) {
    const excess = buckets.size - MAX_TRACKED_KEYS + 1;
    let dropped = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

function humanDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours}h ${minutes}m`;
}

/** The seam for paid plans — see the note above. */
function budgetFor(_req: Request): { calls: number; cooldownMs: number; windowMs: number } {
  return { calls: DAILY_CALL_BUDGET, cooldownMs: COOLDOWN_MS, windowMs: BUDGET_WINDOW_MS };
}

/**
 * Counts and caps calls to the endpoints that run a model.
 *
 * @param keyFor must produce the same per-user key the other limiters use, so
 *   one account cannot get a second budget by looking like a different client
 *   to this middleware than it does to the rate limiter beside it.
 */
export function dailyUsageLimit(keyFor: (req: Request) => string) {
  return function dailyUsageLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    const key = keyFor(req);
    const { calls, cooldownMs, windowMs } = budgetFor(req);

    let bucket = buckets.get(key);

    if (bucket?.cooldownUntil != null) {
      if (now < bucket.cooldownUntil) {
        const remaining = bucket.cooldownUntil - now;
        logger.warn({ key, path: req.path, remainingMs: remaining }, "Usage cooldown — request refused");
        res.setHeader("Retry-After", String(Math.ceil(remaining / 1000)));
        res.status(429).json({
          error: `You've used today's ${calls} Vera analyses. You can pick back up in ${humanDuration(remaining)}.`,
          retryAfterSeconds: Math.ceil(remaining / 1000),
        });
        return;
      }
      // Cooldown served — this is what refills the budget.
      bucket = undefined;
      buckets.delete(key);
    }

    if (!bucket || bucket.windowEndsAt <= now) {
      sweep(now);
      bucket = { spent: 0, windowEndsAt: now + windowMs, cooldownUntil: null };
      buckets.set(key, bucket);
    }

    bucket.spent += 1;

    // Counted BEFORE the handler runs, deliberately. Charging on completion
    // would mean a request that fails slowly (a Groq timeout) costs the user
    // nothing while still costing the quota it is meant to protect, and it
    // would let a client cancel just before completion to spend for free.
    if (bucket.spent >= calls) {
      bucket.cooldownUntil = now + cooldownMs;
      logger.warn({ key, spent: bucket.spent, cooldownMs }, "Usage budget exhausted — cooldown started");
    }

    // Same header family express-rate-limit emits, so a client can show a
    // remaining count without knowing which limiter produced it.
    res.setHeader("RateLimit-Policy", `${calls};w=${Math.floor(windowMs / 1000)}`);
    res.setHeader("RateLimit-Remaining", String(Math.max(0, calls - bucket.spent)));

    next();
  };
}

/** Test hook — lets a suite start from a known state without waiting 24 hours. */
export function __resetUsageBuckets(): void {
  buckets.clear();
}
