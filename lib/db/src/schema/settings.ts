import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  groqApiKey: text("groq_api_key"),
  tier: text("tier").notNull().default("personal"),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  companyName: text("company_name"),
  stage: text("stage"),
  industry: text("industry"),
  teamSize: text("team_size"),
  country: text("country"),
  primaryGoal: text("primary_goal"),
  // Freeform business context Venus AI has learned from the conversation
  // itself (as opposed to the structured onboarding fields above, which are
  // filled in explicitly through the onboarding flow). This is what lets
  // Venus remember "I'm building a B2B SaaS for clinics in India" across
  // every future question — in this session and in brand new sessions —
  // without asking again, until the user starts a genuinely different idea.
  //
  // LEGACY as of business_profiles: this column is now only the seed value
  // getOrCreateActiveProfile reads ONCE per founder to auto-provision their
  // first profile (see businessProfiles.ts) so existing accounts aren't
  // reset to nothing. The live source of truth afterward is
  // business_profiles.contextBlob for whichever profile activeProfileId
  // points at — this column is no longer written to on that path.
  venusBusinessContext: text("venus_business_context"),
  venusBusinessContextUpdatedAt: timestamp("venus_business_context_updated_at"),
  // Which business_profiles row is "the current business" for this founder
  // right now. Null until getOrCreateActiveProfile first runs for them.
  activeProfileId: integer("active_profile_id"),
  // Set when the founder just confirmed "new" to "is this the same business
  // or a new one?" — the description they give in their VERY NEXT message is
  // checked against their other existing profiles (see findMatchingProfile)
  // before deciding whether to restore one or create a new one, instead of
  // always destructively starting from zero. Cleared as soon as that next
  // message is handled, whether or not it turned out to actually be a
  // business description (see isPureContextStatement guard in ai.ts).
  pendingNewProfileIntake: boolean("pending_new_profile_intake").notNull().default(false),
  // Set when Venus asks "is this the same business or a new one?" (see
  // buildBusinessContextConfirmation in ai.ts) so the VERY NEXT message in
  // this session can be interpreted as the answer to that specific question,
  // instead of being re-run through the normal classifiers from scratch —
  // which is what let short replies like "new" fall through every gate
  // unrecognized and reach the LLM with stale or empty context. Cleared as
  // soon as the pending confirmation is resolved, one way or the other.
  pendingContextConfirmation: boolean("pending_context_confirmation").notNull().default(false),
  // Mirrors pendingContextConfirmation's pattern for a different question: set
  // when a message looked like a standing preference/correction (see
  // preferenceDetection.ts) and Venus asked "should I remember this going
  // forward?" — holds the model's own cleaned-up candidate text (not the raw
  // message) so the very next reply is checked against THIS specific
  // question before any other classifier runs. Null = no confirmation
  // pending. Cleared as soon as the founder answers either way.
  pendingPreferenceText: text("pending_preference_text"),
  // Same pending-confirmation pattern again, for a third specific question:
  // set when a new business-context statement looks like it contradicts an
  // already-stored company_facts row (see companyMemory.findPotentialContradiction)
  // and Venus asked "you told me X before, now Y — update it, or both true?"
  // JSON-encoded { oldFactId, newFactText, factType, sourceType } so the next
  // reply can be resolved (supersedeFact vs. add-as-new) without re-deriving
  // any of it. Null = no contradiction pending.
  pendingFactContradiction: text("pending_fact_contradiction"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
