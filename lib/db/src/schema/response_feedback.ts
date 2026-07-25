import { pgTable, serial, text, integer, timestamp, index, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Structured record of the moments a founder told Vera it was WRONG.
//
// WHY THIS EXISTS: before this table, that signal was thrown away entirely.
// The only correction-detection in the codebase (preferenceDetection.ts's
// looksLikeCorrection) requires a message to BOTH open with a rejection word
// ("no", "actually", "don't"…) AND be about a style preference (em-dashes,
// tone, answer length) — and even when it fires, the only thing it can store
// is a formatting preference. There was nowhere at all to record "Vera stated
// a false fact here."
//
// Measured against a real failing session, all three of the founder's actual
// corrections were invisible to it:
//   "the cambridge skls u mentioned, no such ones exist"
//   "these are false too"
//   "i dint ask mail, give me lsit of real skls"
// None open with a rejection word in the required position; none are about
// style. So Vera fabricated school names, was told three times, and retained
// nothing — the same failure was free to recur on the next query.
//
// Each row is simultaneously two things:
//   1. A debugging record — makes failure PATTERNS visible ("keeps inventing
//      names when asked for a list") instead of anecdotal.
//   2. A permanent regression test case, produced by real usage rather than
//      hand-authored. This is the only eval source that grows at the same
//      rate the product is used; see scripts/src/vera-eval.ts, which seeds
//      its corpus from these rows.
//
// Deliberately stores the full triple (what was asked → what Vera answered →
// what the founder said was wrong). A correction alone is unusable as a test
// case; you need the input that produced the bad output.
//
// userId-scoped like every other table here, so one founder's corrections are
// never surfaced into another's session. No FK constraints, matching the
// convention used by messages/goals/venus_decisions.
export const responseFeedbackTable = pgTable(
  "response_feedback",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    chatId: integer("chat_id"),
    // The question that produced the answer being corrected — the actual
    // test input for a replay.
    originalQuery: text("original_query"),
    // What Vera answered (the summary text the founder actually read, not
    // the full card JSON).
    originalResponse: text("original_response"),
    // The founder's own words rejecting it — kept verbatim, never normalized,
    // since the phrasing itself is data about how corrections get expressed.
    correctionText: text("correction_text").notNull(),
    // Model's short read of WHAT was wrong (e.g. "claimed schools that don't
    // exist"). Nullable: a correction is worth recording even when the
    // classifier can't articulate the failure.
    detectedIssue: text("detected_issue"),
    // Coarse failure family for the failure-CLASS metric (see vera-eval.ts).
    // Tracking a rate per class is what generalizes; counting failures on a
    // fixed list of known-bad queries does not.
    issueClass: text("issue_class"), // "fabricated_entity" | "misread_intent" | "wrong_topic" | "other"
    // Whether this row has been folded into the eval corpus yet — lets the
    // eval runner pick up only what's new instead of rebuilding every time.
    consumedByEval: boolean("consumed_by_eval").default(false),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("response_feedback_user_id_idx").on(table.userId),
    // The eval runner's primary access pattern: "everything not yet consumed."
    index("response_feedback_consumed_idx").on(table.consumedByEval),
  ],
);

export const insertResponseFeedbackSchema = createInsertSchema(responseFeedbackTable).omit({
  id: true,
  createdAt: true,
});
export type InsertResponseFeedback = z.infer<typeof insertResponseFeedbackSchema>;
export type ResponseFeedback = typeof responseFeedbackTable.$inferSelect;
