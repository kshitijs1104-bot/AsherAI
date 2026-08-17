import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ---- The security log that survives a restart ----
//
// THE GAP THIS CLOSES. Vera already logged its security events — rate-limit
// trips, blocked cross-origin writes, rejected uploads, attachment-ownership
// misses — carefully and at the right level. It logged them to stdout. On this
// deployment that means a console you have to be watching, with no retention
// and no way to ask a question of it. So "view security events", "search
// events by user" and "export logs" were all impossible, and every incident
// investigation began with the evidence already gone.
//
// This table is the durable half. Pino keeps its job (fast, structured,
// everything); this records only the events an operator would ever need to go
// back and READ, which is a much smaller set, so the table stays small enough
// to query without an index-tuning exercise.
//
// TWO RULES, both about what must never end up in here:
//
//   1. NEVER user content. Not a message, not a filename, not a draft, not a
//      dossier field. This table is read by an operator looking at somebody
//      else's account, and the whole reason it can exist without being a
//      privacy problem is that it contains only WHAT HAPPENED, never WHAT WAS
//      SAID. `metadata` is for ids, counts and route names.
//   2. NEVER a credential or a token, obviously, and never a raw IP — the
//      privacy policy states IP addresses are not stored, and this table is
//      exactly where that sentence would quietly become false. The `subject`
//      column holds the limiter's key form (`u:<userId>` or `ip:<subnet>`),
//      which for the unauthenticated case is a coarse subnet and not an
//      address.
//
// Retention is not automated here. The policy commits to 90 days; add a delete
// on `created_at` when there is a scheduler to run it (see jobs/dailyJob.ts).
export const auditEventsTable = pgTable(
  "audit_events",
  {
    id: serial("id").primaryKey(),

    /**
     * What happened, as a stable dotted slug. Kept as free text rather than a
     * pg enum so adding an event type is a code change and not a migration —
     * the readers below all filter by prefix.
     *
     * Conventions in use:
     *   auth.suspended / auth.unsuspended / auth.blocked_suspended
     *   abuse.rate_limited / abuse.usage_exhausted / abuse.csrf_blocked
     *   abuse.upload_rejected / abuse.ownership_miss
     *   account.deleted / account.data_deleted
     *   operator.viewed_user / operator.exported
     */
    eventType: text("event_type").notNull(),

    /** Whose account this is ABOUT. Null for events with no user (an
     *  unauthenticated limiter trip). */
    userId: text("user_id"),

    /** Who CAUSED it, when that differs from userId — the operator on an
     *  operator action, otherwise the same user. Null for system events. */
    actorId: text("actor_id"),

    /** The limiter-style key the event was attributed to: `u:<userId>` or
     *  `ip:<subnet>`. Never a bare IP address — see rule 2 above. */
    subject: text("subject"),

    /** Route this happened on, path only, no query string. */
    route: text("route"),

    /** "info" | "warn" | "critical". Drives sort order in the operator view. */
    severity: text("severity").notNull().default("info"),

    /** Small JSON blob of ids/counts. Never content — see rule 1 above. */
    metadataJson: text("metadata_json"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    // The three questions this table exists to answer: "what happened to this
    // user", "what happened recently", "what happened of this kind".
    index("audit_events_user_id_idx").on(table.userId),
    index("audit_events_created_at_idx").on(table.createdAt),
    index("audit_events_type_idx").on(table.eventType),
  ],
);

export const insertAuditEventSchema = createInsertSchema(auditEventsTable).omit({ id: true, createdAt: true });
export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type AuditEvent = typeof auditEventsTable.$inferSelect;
