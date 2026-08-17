import { db, userStatusTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { recordAuditEvent } from "./auditLog";

/* ---------------------------------------------------------------------------
   Suspension: the reversible middle between "do nothing" and "delete them".

   Read on every authenticated request (see middlewares/auth.ts), so it has to
   be cheap and it has to fail in the right direction. Both are decisions worth
   stating rather than inferring from the code.

   FAILS OPEN, ON PURPOSE. If this lookup throws — the table is missing, the
   database is briefly unreachable — the request is allowed through. That is the
   opposite of the usual rule, and it is right here for one reason: the
   alternative is that a database blip logs out every founder simultaneously and
   the product is down for everyone in order to enforce a suspension on nobody.
   The population this protects against is a handful of abusive accounts; the
   population it would lock out is all of them. The failure is logged at error
   so it cannot be silent.

   CACHED FOR A FEW SECONDS. A per-request SELECT on every route, for a table
   that is empty for virtually every user, is a lot of queries to answer "no".
   The cache is deliberately short: a suspension has to bite in seconds, not
   whenever a session token happens to expire, and SUSPENSION_CACHE_MS is the
   longest an already-signed-in abusive user keeps working after you click
   suspend. Writes clear the entry immediately, so the delay only ever applies
   to instances other than the one that served the change.
--------------------------------------------------------------------------- */

const SUSPENSION_CACHE_MS = 10_000;
const MAX_CACHE_ENTRIES = 20_000;

interface CacheEntry {
  suspended: boolean;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(userId: string): boolean | null {
  const hit = cache.get(userId);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(userId);
    return null;
  }
  return hit.suspended;
}

function cacheSet(userId: string, suspended: boolean): void {
  // Bounded so a stream of distinct user ids cannot grow it without limit. An
  // abuse control that is itself a memory-exhaustion vector is not a control.
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  cache.set(userId, { suspended, expiresAt: Date.now() + SUSPENSION_CACHE_MS });
}

export function invalidateStatusCache(userId: string): void {
  cache.delete(userId);
}

/**
 * Whether this account is currently suspended.
 *
 * Absence of a row means active — see the schema comment for why there is no
 * row per user. Any unrecognised status value is also treated as active, so a
 * typo in a manual SQL fix cannot lock somebody out.
 */
export async function isSuspended(userId: string): Promise<boolean> {
  const cached = cacheGet(userId);
  if (cached !== null) return cached;

  try {
    const [row] = await db
      .select({ status: userStatusTable.status })
      .from(userStatusTable)
      .where(eq(userStatusTable.userId, userId))
      .limit(1);
    const suspended = row?.status === "suspended";
    cacheSet(userId, suspended);
    return suspended;
  } catch (err) {
    // Fails open — see the header. Logged at error because a suspension check
    // that is not running is a control that is not running.
    logger.error({ err, userId }, "Suspension check failed — allowing the request through");
    return false;
  }
}

export interface StatusChange {
  userId: string;
  actorId: string;
  reason: string;
}

/**
 * Suspends an account. Takes effect on the user's next request (plus at most
 * SUSPENSION_CACHE_MS on other instances) rather than whenever their session
 * token expires, which is the difference between a control and a delay.
 *
 * `reason` is required by this signature rather than by the column, because a
 * suspension nobody can review later is one that will be argued about.
 */
export async function suspendUser({ userId, actorId, reason }: StatusChange): Promise<void> {
  await db
    .insert(userStatusTable)
    .values({ userId, status: "suspended", reason, actorId })
    .onConflictDoUpdate({
      target: userStatusTable.userId,
      set: { status: "suspended", reason, actorId, updatedAt: new Date() },
    });

  invalidateStatusCache(userId);
  await recordAuditEvent({
    eventType: "auth.suspended",
    userId,
    actorId,
    severity: "critical",
    metadata: { reason },
  });
  logger.warn({ userId, actorId }, "Account suspended");
}

/** Restores access. The row is kept, so the history of the suspension survives. */
export async function unsuspendUser({ userId, actorId, reason }: StatusChange): Promise<void> {
  await db
    .insert(userStatusTable)
    .values({ userId, status: "active", reason, actorId })
    .onConflictDoUpdate({
      target: userStatusTable.userId,
      set: { status: "active", reason, actorId, updatedAt: new Date() },
    });

  invalidateStatusCache(userId);
  await recordAuditEvent({
    eventType: "auth.unsuspended",
    userId,
    actorId,
    severity: "warn",
    metadata: { reason },
  });
  logger.warn({ userId, actorId }, "Account restored");
}

/** Test hook so a suite can start from a known state. */
export function __resetStatusCache(): void {
  cache.clear();
}
