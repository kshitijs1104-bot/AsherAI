import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces the single flat settings.venusBusinessContext blob with N
// switchable business contexts per founder. Before this table, "is this the
// same business or a new one?" (see classifyContextConfirmationReply in
// ai.ts) treated "new" as a destructive reset: the old blob and the old
// company_facts rows were cleared so they wouldn't leak into the new
// business's answers. That's correct for a genuine one-time pivot, but a
// founder juggling 2-3 real businesses and switching back and forth lost
// everything Vera knew about the one they'd just left — coming back to it
// meant re-describing it from scratch, not "remembered for later."
//
// This table makes a business context a named, switchable row instead of
// the account's one and only context: switching away deactivates a profile
// without deleting it, and switching back (detected via findMatchingProfile
// in businessProfiles.ts, a small token-overlap check against the handful
// of profiles a founder actually has) restores its facts instead of
// starting over.
//
// userId-scoped, no DB-enforced FK, matching the convention used by
// company_facts/messages/goals/venus_decisions.
export const businessProfilesTable = pgTable(
  "business_profiles",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),

    // Short display name, auto-derived from the founder's own first real
    // description (see deriveProfileName) rather than requiring them to name
    // it up front — this only ever gets shown back to them as "switching
    // back to X", never asked for.
    name: text("name").notNull(),

    // Same freeform blob settings.venusBusinessContext used to be, now
    // scoped to this one business instead of the whole account.
    contextBlob: text("context_blob"),
    contextUpdatedAt: timestamp("context_updated_at"),

    // Bumped every time this profile becomes the active one — lets a future
    // "switch business" UI list profiles by recency without a separate
    // events table.
    lastActiveAt: timestamp("last_active_at").defaultNow(),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("business_profiles_user_id_idx").on(table.userId),
  ],
);

export const insertBusinessProfileSchema = createInsertSchema(businessProfilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBusinessProfile = z.infer<typeof insertBusinessProfileSchema>;
export type BusinessProfile = typeof businessProfilesTable.$inferSelect;
