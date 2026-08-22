import type { NextFunction, Request, Response } from "express";
import { db, usageDailyTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { recordAuditEvent } from "../lib/auditLog";

/* ---------------------------------------------------------------------------
   The free plan's usage ceiling.

   WHY THIS IS NOT `express-rate-limit`. Everything else in app.ts is, and
   should stay that way — but this rule has semantics its fixed-window model
   cannot express. express-rate-limit starts a window at the FIRST request in
   it, so "250 per 5 hours" means someone who spends 1 call at 09:00 and the
   remaining 249 at 13:50 is free again at 14:00, ten minutes after hitting the
   cap. The rule here is a COOLDOWN: the clock starts when the budget runs out,
   not when it started being spent, so the wait is always the full five hours
   however the calls were distributed.

   WHY IT IS NOW IN POSTGRES AND NOT A Map. The previous version held buckets in
   process memory, and its own comment named the two consequences honestly: the
   real ceiling was the budget times the number of autoscale instances, and a
   redeploy cleared every cooldown. Both mattered more than they looked, because
   Groq bills against an ORG-WIDE daily quota — an unbounded account does not
   just run up its own bill, it spends the budget every other founder's next
   question needs. A counter that resets whenever you deploy is not a cap on the
   thing that costs money.

   Moving it to a row also made it READABLE, which turned out to matter as much
   as the correctness: "who is spending the shared quota today" is now a query
   the operator surface answers (see routes/operator.ts) instead of a number
   that existed only inside whichever process served the request.

   THE SHAPE, unchanged from before:

     - Every user gets DAILY_CALL_BUDGET model calls.
     - Spending the last one starts a COOLDOWN_MS lockout, timed from that
       moment. Requests during it are refused with the real time remaining.
     - Serving the cooldown refills the budget in full.

   WORST CASE, SAID OUT LOUD: because the cooldown is what refills the budget,
   somebody deliberately maxing out gets 250 calls every 5 hours — up to about
   1,200 in a day, not 250. That is the arithmetic of "cap then cooldown". If a
   hard 250-per-day is wanted instead, set COOLDOWN_MS to a value that runs past
   midnight UTC, or drop the cooldown and rely on the day boundary alone.

   FAILS OPEN. If the database is unreachable this allows the request through
   and logs at error. Same reasoning as the suspension check: the alternative is
   that a database blip makes Vera answer nothing for everybody in order to
   enforce a cap on nobody. The per-minute limiter in app.ts is in-memory and
   still applies, so "fails open" here means falling back to 30/min rather than
   to unlimited.

   PLAN AWARENESS: there is no plan column yet. `budgetFor(req)` is the seam —
   read the user's plan there and return its numbers.
--------------------------------------------------------------------------- */

const DAILY_CALL_BUDGET = 250;
const COOLDOWN_MS = 5 * 60 * 60 * 1000;

/** The seam for paid plans — see the note above. */
function budgetFor(_req: Request): { calls: number; cooldownMs: number } {
  return { calls: DAILY_CALL_BUDGET, cooldownMs: COOLDOWN_MS };
}

// UTC, not the founder's local day. A local-day reset needs a timezone per user,
// which this schema does not have, and getting it wrong means the budget resets
// at an hour the founder cannot predict. A fixed UTC day is wrong for everyone
// by the same amount, which is the better failure.
function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function humanDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours}h ${minutes}m`;
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
    void (async () => {
      const now = new Date();
      const subject = keyFor(req);
      const day = utcDay(now);
      const { calls, cooldownMs } = budgetFor(req);

      try {
        // Read first, then write. Deliberately two statements rather than one
        // clever upsert: the request that SPENDS the last call is allowed
        // through (it is within budget), and only the ones after it are
        // refused — expressing "allow this one, refuse the next" inside a
        // single ON CONFLICT clause makes it unreadable, and this runs ahead of
        // a multi-second model call where two fast queries cost nothing.
        //
        // The race two concurrent requests can win here is going one or two
        // calls over the budget. That is an acceptable overshoot for an abuse
        // control and not worth a lock.
        const [existing] = await db
          .select({ spent: usageDailyTable.spent, cooldownUntil: usageDailyTable.cooldownUntil })
          .from(usageDailyTable)
          .where(and(eq(usageDailyTable.subject, subject), eq(usageDailyTable.day, day)))
          .limit(1);

        const cooldownUntil = existing?.cooldownUntil ?? null;
        const lockedOut = cooldownUntil !== null && cooldownUntil.getTime() > now.getTime();

        if (lockedOut) {
          const remaining = cooldownUntil!.getTime() - now.getTime();
          logger.warn({ subject, path: req.path, remainingMs: remaining }, "Usage cooldown — request refused");
          void recordAuditEvent({
            eventType: "abuse.usage_cooldown",
            subject,
            route: req.path,
            severity: "warn",
            metadata: { remainingMs: remaining },
          });
          res.setHeader("Retry-After", String(Math.ceil(remaining / 1000)));
          res.status(429).json({
            error: `You've used today's ${calls} Asher analyses. You can pick back up in ${humanDuration(remaining)}.`,
            retryAfterSeconds: Math.ceil(remaining / 1000),
          });
          return;
        }

        // A cooldown that has expired is what refills the budget, so this
        // request starts a fresh count rather than continuing the old one.
        const cooldownJustServed = cooldownUntil !== null;
        const priorSpent = cooldownJustServed ? 0 : (existing?.spent ?? 0);
        const nextSpent = priorSpent + 1;
        const exhausted = nextSpent >= calls;

        // Charged BEFORE the handler runs, deliberately. Charging on completion
        // would mean a request that fails slowly (a Groq timeout) costs the
        // user nothing while still costing the quota it is meant to protect,
        // and it would let a client cancel just before completion to spend for
        // free.
        await db
          .insert(usageDailyTable)
          .values({
            subject,
            day,
            spent: nextSpent,
            cooldownUntil: exhausted ? new Date(now.getTime() + cooldownMs) : null,
          })
          .onConflictDoUpdate({
            target: [usageDailyTable.subject, usageDailyTable.day],
            set: {
              // Recomputed in SQL rather than written from the value read
              // above, so two concurrent requests both increment instead of
              // one overwriting the other with a stale number.
              spent: cooldownJustServed ? sql`1` : sql`${usageDailyTable.spent} + 1`,
              cooldownUntil: exhausted ? new Date(now.getTime() + cooldownMs) : null,
              updatedAt: now,
            },
          });

        if (exhausted) {
          logger.warn({ subject, spent: nextSpent, cooldownMs }, "Usage budget exhausted — cooldown started");
          void recordAuditEvent({
            eventType: "abuse.usage_exhausted",
            subject,
            route: req.path,
            severity: "warn",
            metadata: { spent: nextSpent, cooldownMs },
          });
        }

        // Same header family express-rate-limit emits, so a client can show a
        // remaining count without knowing which limiter produced it.
        res.setHeader("RateLimit-Policy", `${calls};w=86400`);
        res.setHeader("RateLimit-Remaining", String(Math.max(0, calls - nextSpent)));

        next();
      } catch (err) {
        // Fails open — see the header.
        logger.error({ err, subject }, "Usage limit check failed — allowing the request through");
        next();
      }
    })();
  };
}
