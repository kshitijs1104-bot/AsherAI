import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ---- The model-call budget, moved out of process memory ----
//
// THE GAP THIS CLOSES. middlewares/usageLimit.ts held its buckets in a
// module-level Map, and its own comment named the two consequences honestly:
// the ceiling is really the budget times the number of autoscale instances,
// and a redeploy clears every cooldown. Both matter more than they look,
// because Groq bills against an ORG-WIDE quota — an unbounded user does not
// just run up their own bill, they spend the budget every other founder's next
// question needs.
//
// A row per user per UTC day makes the count survive both. It also turns the
// counter into something readable: "who spent what today" is now a query
// rather than a number that exists only inside whichever process happened to
// serve the request.
//
// WHY UTC AND NOT THE FOUNDER'S LOCAL DAY. A local-day reset needs a timezone
// per user, which this schema does not have, and getting it wrong means the
// budget resets at an hour the founder cannot predict. A fixed UTC day is
// wrong for everyone by the same amount, which is the better failure.
//
// `cooldownUntil` preserves the existing semantics exactly: spending the last
// call starts a cooldown timed from that moment, and serving the cooldown is
// what refills the budget. See usageLimit.ts for why that is a cooldown and
// not a rolling window.
export const usageDailyTable = pgTable(
  "usage_daily",
  {
    id: serial("id").primaryKey(),

    /** Clerk user id, or the limiter's `ip:<subnet>` key for unauthenticated
     *  callers — the same key the rate limiters use, so one caller cannot get
     *  a second budget by looking like a different client to this table than
     *  it does to the limiter beside it. */
    subject: text("subject").notNull(),

    /** UTC date as YYYY-MM-DD. A string rather than a date column so the
     *  unique index below is an exact match and never a timezone conversion. */
    day: text("day").notNull(),

    /** Model calls charged so far today. Incremented BEFORE the handler runs,
     *  so a slow failure still costs the quota it consumed. */
    spent: integer("spent").notNull().default(0),

    /** Set only while locked out. Null means the budget is available. */
    cooldownUntil: timestamp("cooldown_until"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  // One row per subject per day. This is what makes the atomic upsert-then-
  // increment safe against two instances serving the same user at once.
  (table) => [uniqueIndex("usage_daily_subject_day_idx").on(table.subject, table.day)],
);

export const insertUsageDailySchema = createInsertSchema(usageDailyTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUsageDaily = z.infer<typeof insertUsageDailySchema>;
export type UsageDaily = typeof usageDailyTable.$inferSelect;
