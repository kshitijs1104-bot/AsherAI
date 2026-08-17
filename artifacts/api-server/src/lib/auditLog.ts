import { db, auditEventsTable } from "@workspace/db";
import { logger } from "./logger";

/* ---------------------------------------------------------------------------
   Writing the security trail that survives a restart.

   Pino keeps doing what it does — fast, structured, everything, to stdout.
   This is the much smaller set of events an operator would ever need to go
   BACK and read: who was suspended and why, which account is tripping
   limiters, who walked attachment ids, what the operator themselves did.

   THREE PROPERTIES THIS HELPER GUARANTEES, so no call site has to remember
   them:

     1. IT NEVER THROWS. Every caller is a request handler doing something
        else — refusing an upload, blocking a write, deleting an account. An
        audit write failing must never turn one of those into a 500, because
        then a full disk or a locked table would take the product down in the
        name of recording that the product was working. Failures go to the
        process log and are swallowed.

     2. IT NEVER BLOCKS. Call sites use `void recordAuditEvent(...)` and move
        on. The write is a single INSERT with no read; ordering between two
        events a millisecond apart is not something anyone investigating needs.

     3. IT NEVER CARRIES CONTENT. `metadata` is serialised here, and anything
        that is not a primitive is dropped rather than stringified. That is
        deliberate: it makes it structurally awkward to pass a message body, a
        filename or a dossier field into this table by accident. The schema
        comment explains why that rule is what lets an operator read another
        founder's security events without reading the founder.
--------------------------------------------------------------------------- */

export type AuditSeverity = "info" | "warn" | "critical";

export interface AuditEventInput {
  /** Stable dotted slug — see the schema for the conventions in use. */
  eventType: string;
  /** Whose account this is about. */
  userId?: string | null;
  /** Who caused it, when that differs from userId (an operator action). */
  actorId?: string | null;
  /** Limiter-style key: `u:<userId>` or `ip:<subnet>`. Never a bare address. */
  subject?: string | null;
  /** Path only, no query string. */
  route?: string | null;
  severity?: AuditSeverity;
  /** Ids and counts only. Non-primitives are dropped, not stringified. */
  metadata?: Record<string, unknown>;
}

const MAX_METADATA_CHARS = 1000;

// Primitives only. An object or array here is almost always a mistake — it is
// how a whole request body ends up in an audit row — so it is dropped and the
// drop is recorded, rather than being silently serialised.
function safeMetadata(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) return null;
  const clean: Record<string, string | number | boolean> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      clean[key] = typeof value === "string" ? value.slice(0, 200) : value;
    } else {
      dropped.push(key);
    }
  }
  if (dropped.length > 0) clean._dropped = dropped.join(",");
  const json = JSON.stringify(clean);
  return json.length > MAX_METADATA_CHARS ? json.slice(0, MAX_METADATA_CHARS) : json;
}

export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    await db.insert(auditEventsTable).values({
      eventType: input.eventType,
      userId: input.userId ?? null,
      actorId: input.actorId ?? null,
      subject: input.subject ?? null,
      route: input.route ?? null,
      severity: input.severity ?? "info",
      metadataJson: safeMetadata(input.metadata),
    });
  } catch (err) {
    // Property 1. The one place this must not cascade.
    logger.error({ err, eventType: input.eventType }, "Could not write audit event");
  }
}
