import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ---- The row that lets an account be stopped without being destroyed ----
//
// THE GAP THIS CLOSES. Section 11 of the terms reserves the right to suspend
// an account. Nothing implemented it. The only lever that existed was deleting
// the Clerk user, which is irreversible, takes the login and every future
// login with it, and leaves every Vera row behind with no way to reach them.
// So the actual choice during an abuse incident was "destroy this person's
// account" or "do nothing", and neither is what a suspension is for.
//
// A row here is the reversible middle. `status` is checked by requireAuth on
// every authenticated request (see middlewares/auth.ts), so suspending takes
// effect on the founder's next request rather than whenever their session
// token happens to expire — which is the difference between a control and a
// delay.
//
// ABSENCE OF A ROW MEANS ACTIVE. Deliberately: there is no users table in this
// schema (identity lives in Clerk), so this cannot be a column on one, and a
// table that had to contain a row per user before anyone could log in would be
// a new way for authentication to fail. Only accounts that have been acted on
// appear here at all, which also makes the table itself the list of accounts
// you have ever acted on.
//
// `reason` is required by the writer rather than the column, because a
// suspension with no recorded reason is one nobody can review later — but it
// is nullable here so an older row or a manual SQL fix can never fail to load.
export const userStatusTable = pgTable(
  "user_status",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** "active" | "suspended". Anything unrecognised is treated as active. */
    status: text("status").notNull().default("active"),
    /** Why, in the operator's own words. Shown to nobody but the operator. */
    reason: text("reason"),
    /** Clerk user id of whoever made the change — never null in practice. */
    actorId: text("actor_id"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  // One row per user, upserted. The unique index is what makes
  // onConflictDoUpdate safe for the suspend/unsuspend path.
  (table) => [uniqueIndex("user_status_user_id_idx").on(table.userId)],
);

export const insertUserStatusSchema = createInsertSchema(userStatusTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserStatus = z.infer<typeof insertUserStatusSchema>;
export type UserStatus = typeof userStatusTable.$inferSelect;
