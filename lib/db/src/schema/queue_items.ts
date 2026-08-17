import { pgTable, serial, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Command Center's queue: things Vera already drafted, decided, or found,
// waiting on a founder yes/edit/no. Never a prompt box — every row here is
// the OUTPUT of something (a connector poll, a workflow run, a follow-up
// check on a resolved decision), not a task the founder types in themselves.
//
// Scoped by userId only, matching every other table in this schema (goals,
// roadmaps, venus_decisions) — this app has no org/tenant concept, just a
// Clerk-authenticated founder.
//
// source is a loose free-text tag ("gmail", "workflow:weekly-report",
// "decision-followup") rather than a foreign key into a connectors/workflows
// table — those tables don't exist yet (later phases), and a queue item
// must still make sense to display/resolve even if its originating
// connector/workflow is later deleted or renamed.
//
// draftContent holds the actual editable payload (e.g. a draft email body)
// separately from body (the human-readable preview shown in the list) so
// an "edit" action has something structured to work from without re-parsing
// display text. Nullable — not every item type has an editable draft (e.g.
// a plain alert/insight).
export const queueItemsTable = pgTable(
  "queue_items",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),

    type: text("type").notNull(),
    source: text("source").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    draftContent: text("draft_content"),

    // Connector/workflow-supplied idempotency key (e.g. a Gmail thread id, a
    // workflow run's period key) — lets a poller safely re-run on the same
    // data every cycle via insert().onConflictDoNothing() instead of needing
    // its own separate "have I seen this" bookkeeping. Null for anything not
    // sourced from a repeatable poll (manual instant-actions, one-off alerts).
    externalId: text("external_id"),

    // Structured, source-specific data an "accept" needs to actually DO the
    // thing the draft represents (e.g. gmail: { threadId, to, subject };
    // slack: { channelId }) — JSON text, same convention as draftContent.
    // Null for item types where accept has no live side effect (a plain
    // insight/alert, an automation suggestion).
    metadataJson: text("metadata_json"),

    // pending -> accepted | edited | rejected. Terminal states keep the row
    // (resolvedAt set) rather than deleting it — a founder's accept/reject
    // history is itself a signal (e.g. future "you keep rejecting X" tuning).
    status: text("status").notNull().default("pending"),

    // ---- Unread state, for the notification dot ----
    //
    // Null means the founder has never had this item on screen. Set the first
    // time the board is opened after it arrived.
    //
    // DELIBERATELY SEPARATE FROM `status`. An item can be seen and still
    // pending (read it, haven't acted), or unseen and already resolved (a
    // workflow accepted it automatically). Collapsing "have I looked at this"
    // into "is it done" would make the dot lie in both directions — it would
    // clear when a founder actioned one item out of five, and it would light up
    // again for something they had already read but chosen to leave.
    seenAt: timestamp("seen_at"),

    createdAt: timestamp("created_at").defaultNow(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    // Every read is "this user's queue," almost always filtered to pending
    // for the badge/list — same composite-index shape as venus_decisions.
    index("queue_items_user_status_idx").on(table.userId, table.status),
    uniqueIndex("queue_items_dedupe_idx").on(table.userId, table.source, table.externalId),
  ],
);

export const insertQueueItemSchema = createInsertSchema(queueItemsTable).omit({
  id: true,
  createdAt: true,
  resolvedAt: true,
});
export type InsertQueueItem = z.infer<typeof insertQueueItemSchema>;
export type QueueItem = typeof queueItemsTable.$inferSelect;
