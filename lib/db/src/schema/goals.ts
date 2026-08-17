import { pgTable, serial, integer, text, real, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A Goal is the thing that turns a chat from "a place I asked Venus some
// questions" into "the thread I'm running this specific fight through" —
// e.g. Aurelian's chat carries "close Client X, demo scheduled [date]", the
// Vera chat carries its own build/launch goal. Set once per chat the way a
// Claude Project gets custom instructions: it frames every answer in that
// chat afterward, and every roadmap/decision card generated in that chat is
// implicitly a sub-task of it.
//
// One goal per chat at a time (chatId is unique) — a chat with no goal set
// is just an ordinary chat with no urgency/EV frame attached, which is the
// deliberate default. When a goal is done or no longer relevant the founder
// starts a NEW chat for the next goal; the old chat + its goal are kept,
// never overwritten, so history is retained exactly like switching Claude
// Projects rather than editing one in place.
//
// successMetric / valueInr / deadline are NOT optional embellishments — they
// are the only inputs that let Venus reason about urgency, expected value, or
// trade-offs at all. A goal without a concrete win condition, a rupee value,
// and a deadline is not reasoned about differently than an ordinary chat;
// the API layer should enforce all three are present before a goal is
// considered "set" rather than "draft."
export const goalsTable = pgTable(
  "goals",
  {
  id: serial("id").primaryKey(),
  chatId: integer("chat_id").notNull().unique(),
  userId: text("user_id").notNull(),

  title: text("title").notNull(),
  // The concrete, falsifiable win condition — "demo scheduled and signed by
  // [date]", not "grow the business." This is what lets a roadmap item be
  // judged as evidence FOR or AGAINST the goal instead of just "done."
  successMetric: text("success_metric").notNull(),
  // Rupee value of hitting the goal. Stored as an integer (paise-free, whole
  // rupees) rather than a float — founders size these in round numbers and
  // float rounding has no upside here.
  valueInr: integer("value_inr").notNull(),
  deadline: timestamp("deadline").notNull(),

  // "active" until explicitly resolved. "completed" = success metric was hit.
  // "abandoned" = founder moved on without hitting it (still useful: an
  // abandoned goal's resolved decisions remain real evidence in Decision
  // Memory even though the goal itself didn't land). "at_risk" is NOT a
  // status — it's a read-time judgment derived from evidence vs. time-to-
  // deadline, not a state anyone sets.
  status: text("status").notNull().default("active"),

  // The navigation-line marker position: Origin(0) -> Target(1), but NOT
  // clamped to [0,1] and NOT driven by "N of M tasks checked off." It moves
  // when a roadmap/decision card tied to this goal resolves — a resolved
  // card with outcomeSentiment "positive" pushes it meaningfully toward 1;
  // "negative" barely moves it (or can push it backward — see below);
  // "mixed" moves it a little. This is a running score, not a percentage:
  // recomputing it is a sum over resolved evidence, never a fraction of
  // total sub-tasks, so an unresolved or abandoned roadmap item does not
  // silently count as partial progress.
  evidenceScore: real("evidence_score").notNull().default(0),

  // Free-text, append-only log of why the score moved the way it did (e.g.
  // "cold outreach batch 2: 0/40 replies — approach likely wrong, not just
  // slow" ) so the UI can explain a bend in the path instead of just showing
  // a number. Kept as plain text (one entry per line) rather than a separate
  // table since this is a display aid, not queried structured data.
  evidenceLog: text("evidence_log"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  },
  // GET /goals lists every goal for one founder across all their chats, and
  // filtered only on userId. chatId already has a unique index from the column
  // definition above; this is the cross-chat read that had none.
  (table) => [index("goals_user_id_idx").on(table.userId)],
);

export const insertGoalSchema = createInsertSchema(goalsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
});
export type InsertGoal = z.infer<typeof insertGoalSchema>;
export type Goal = typeof goalsTable.$inferSelect;
