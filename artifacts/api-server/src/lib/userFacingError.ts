/* ---------------------------------------------------------------------------
   "This message was written for the founder" — as a type, not a convention.

   THE PROBLEM THIS SOLVES. Several handlers deliberately returned err.message
   to the caller, and the reason was good: getConnector throws "gmail isn't
   connected — reconnect it to send this.", which is exactly what the founder
   needs to read, and flattening it into "Failed to publish" removes the one
   sentence that tells them what to do.

   But `catch (err)` catches everything. The same block that forwarded that
   helpful sentence also forwarded Postgres errors, LinkedIn API errors and
   anything else thrown in between — so whether the caller received a
   founder-readable sentence or a raw driver string depended entirely on which
   line happened to fail. The intent ("pass MY messages through") was real; it
   just had no way to be expressed, so it was applied to every error instead.

   Throwing this class is that expression. A message is forwarded to the caller
   only if whoever wrote it said it was for the caller. Everything else gets a
   mapped, non-leaking string (see dbErrors.ts).

   USE IT FOR: a precondition the founder can fix — something not connected, not
   configured, already resolved, out of range.
   DO NOT USE IT FOR: anything carrying a table name, a query, a URL, a provider
   response body, or a stack. If the sentence would not make sense on a screen
   in front of a non-technical founder, it does not belong in here.
--------------------------------------------------------------------------- */

export class UserFacingError extends Error {
  /** HTTP status to answer with. 400 unless the caller says otherwise. */
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "UserFacingError";
    this.status = status;
  }
}

export function isUserFacingError(err: unknown): err is UserFacingError {
  return err instanceof UserFacingError;
}

/**
 * The response body for a caught error: the author's own words when they marked
 * them as such, otherwise a mapped database message that leaks nothing.
 *
 * `fallback` lets a route give a more specific generic than dbErrors' default
 * for failures that are not database failures at all (a provider call, a file
 * read). Still a fixed string either way.
 */
export function messageForCaller(err: unknown, fallback: string): string {
  return isUserFacingError(err) ? err.message : fallback;
}
