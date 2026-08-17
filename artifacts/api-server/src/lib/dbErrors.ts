/* ---------------------------------------------------------------------------
   Turning a database failure into one honest sentence — without handing the
   caller the driver's error text.

   THE TENSION THIS RESOLVES. Four route handlers returned `err.message` (or a
   160-character slice of the raw Postgres error) on a 500, bypassing the
   app-level handler that replaces every 5xx body with a fixed string. Each was
   a deliberate choice with a real reason: "relation workflows does not exist"
   showed up to a founder as a silently empty screen, and the specific reason is
   the one fact that fixes it in a minute. Reverting to a canned string would
   bring the blank screen back.

   But the raw message leaks table names, column names and SQL fragments to any
   authenticated caller, and — worse for the founder — it is written for whoever
   wrote the driver, not for them.

   So: MAP THE CODES, HIDE THE TEXT. Postgres error codes are stable and there
   are only a handful that actually occur here, all of them deployment problems.
   Each maps to a sentence that says what to do. Anything unrecognised gets a
   generic line and is logged in full server-side, so a new failure mode surfaces
   in the logs rather than in the response body.

   The real error is ALWAYS logged by the caller. This function decides only what
   the founder sees.

   WHERE THE CODE ACTUALLY LIVES: node-postgres puts `code` on the driver error,
   but drizzle-orm wraps that in a DrizzleQueryError whose own message is just
   "Failed query: <sql>" — the real reason is on `.cause`. Reading only the outer
   error is why an earlier version of this logic never matched any branch and
   always fell through to the useless "Failed query: insert into…" prefix.
--------------------------------------------------------------------------- */

/** Postgres SQLSTATE codes that mean something actionable here. */
const MESSAGE_BY_CODE: Record<string, string> = {
  // undefined_table — the schema was never migrated into this database.
  "42P01": "Vera's database is missing a table it needs — the schema migration hasn't been run on this environment.",
  // undefined_column / invalid_column_reference — schema is behind the code.
  "42703": "Vera's database schema is out of date — the latest migration hasn't been run on this environment.",
  "42P10": "Vera's database schema is out of date — the latest migration hasn't been run on this environment.",
  // unique_violation — a real conflict, not a deployment problem.
  "23505": "That already exists.",
  // foreign_key_violation
  "23503": "That refers to something which no longer exists.",
  // not_null_violation
  "23502": "Something required was missing from that request.",
  // insufficient_privilege — the restricted app role is missing a grant.
  "42501": "Vera's database user isn't permitted to do that — a grant is missing on this environment.",
  // connection failures / admin shutdown / crash recovery
  ECONNREFUSED: "Vera's database isn't reachable right now — try again in a moment.",
  ETIMEDOUT: "Vera's database didn't respond in time — try again in a moment.",
  "57P01": "Vera's database is restarting — try again in a moment.",
  "57P03": "Vera's database isn't accepting connections yet — try again in a moment.",
  "53300": "Vera's database is at its connection limit — try again in a moment.",
};

const GENERIC = "Something went wrong saving that. It's been logged — try again, and tell us if it keeps happening.";

/** The SQLSTATE (or node error code) behind a possibly-wrapped drizzle error. */
export function dbErrorCode(err: unknown): string | null {
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : null;
  const code = (cause as { code?: string } | null)?.code ?? (err as { code?: string } | null)?.code;
  return typeof code === "string" ? code : null;
}

/**
 * One clause about why a write failed, safe to show a founder.
 *
 * Returns a fixed string for anything unrecognised — never the driver's own
 * message. Callers must log the full error separately; this is the response
 * body, not the diagnosis.
 */
export function describeDbError(err: unknown): string {
  const code = dbErrorCode(err);
  return (code && MESSAGE_BY_CODE[code]) || GENERIC;
}

/**
 * True when the failure is a deployment/infrastructure problem rather than
 * anything about this request — useful for deciding between 500 and 503.
 */
export function isInfrastructureError(err: unknown): boolean {
  const code = dbErrorCode(err);
  return code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "57P01" || code === "57P03" || code === "53300";
}
