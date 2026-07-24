import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Section 8 (Recap Ritual) is explicitly low priority in the build plan —
// "placeholder cron job now, full design later." This table and its
// generation are that placeholder: a stored snapshot per (founder, month)
// so the numbers a recap shows are frozen at generation time rather than
// silently drifting if re-read later, but with no shareable-image/PDF
// rendering built yet — that's the "full design" deferred to a later pass.
//
// dataJson shape (see api-server's lib/recap.ts generateMonthlyRecap):
// { decisionsCaptured, lessonsLearned, automationsCompleted, timeSavedMinutes,
//   goalsCompleted, biggestFocus: string | null, topRecommendation: string | null }
export const monthlyRecapsTable = pgTable(
  "monthly_recaps",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    // "YYYY-MM" for the month this recap covers.
    periodMonth: text("period_month").notNull(),
    dataJson: text("data_json").notNull(),
    generatedAt: timestamp("generated_at").defaultNow(),
  },
  (table) => [uniqueIndex("monthly_recaps_user_period_idx").on(table.userId, table.periodMonth)],
);

export const insertMonthlyRecapSchema = createInsertSchema(monthlyRecapsTable).omit({
  id: true,
  generatedAt: true,
});
export type InsertMonthlyRecap = z.infer<typeof insertMonthlyRecapSchema>;
export type MonthlyRecap = typeof monthlyRecapsTable.$inferSelect;
