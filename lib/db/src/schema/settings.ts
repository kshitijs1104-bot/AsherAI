import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  // REMOVED: groqApiKey. It held a founder-supplied Groq API key in plaintext
  // — an actual credential, stored unencrypted next to ordinary business data,
  // while the only other credential in this schema (connectors.oauthTokenRef)
  // is AES-256-GCM encrypted for exactly that reason. The feature that wrote
  // it (/settings/groq-key) had no UI left, so the risk was being carried for
  // nothing. All inference now runs on the server's own GROQ_API_KEY.
  //
  // The column is dropped from the model here; run `drizzle-kit push` (or
  // generate a migration) to drop it in the database and destroy any keys
  // still stored in existing rows.
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
  // ---- Proof that this founder accepted the privacy policy ----
  //
  // Until these existed the record lived only in the browser's localStorage
  // (lib/privacyConsent.ts) — a value on the user's own device, on a clock
  // they control, that they can clear. The gate behaved correctly; what was
  // missing was any evidence that anyone agreed to anything, which is the
  // entire point of recording consent. LAUNCH_CHECKLIST item 3.
  //
  // The version string is stored, not a boolean, because the gate re-prompts
  // when PRIVACY_POLICY_VERSION changes: "accepted" is only ever meaningful
  // paired with WHAT was accepted. The local copy is kept as a cache so the
  // gate does not need a round trip before it can decide whether to render.
  policyVersion: text("policy_version"),
  policyAcceptedAt: timestamp("policy_accepted_at"),

  // ---- The onboarding answers that were being thrown away ----
  //
  // THE GAP THIS CLOSES. The onboarding form (pages/enterprise/Onboarding.tsx)
  // asks for company name, monthly revenue, team size, role and how they heard
  // about Vera — then wrote all of it to localStorage and nowhere else. So the
  // five questions every single founder is made to answer before they can use
  // the product produced ZERO analysable data: no way to know which channel
  // brought them, what stage they are at, or who is actually signing up. The
  // one screen designed to tell you who your users are was telling you nothing.
  //
  // companyName/teamSize/stage/industry/country/primaryGoal already existed
  // above (written by the older /settings/onboarding route). These are the
  // fields the live form collects that had no column at all.
  //
  // Deliberately all nullable and all text: this is self-reported founder
  // input, not validated data. "Monthly revenue" arrives as whatever they
  // typed — "0", "pre-revenue", "~40k" — and coercing that to a number at the
  // boundary would either reject honest answers or invent precision. It is
  // stored as given and interpreted when read.
  monthlyRevenue: text("monthly_revenue"),
  role: text("role"),
  referralSource: text("referral_source"),
  // What they want to be called, if they change it from the Clerk account
  // name. Null means "use the Clerk identity", which is the default and the
  // common case — see routes/profile.ts.
  displayName: text("display_name"),
  // When the funnel was actually completed, distinct from onboardingCompleted
  // (a boolean that cannot answer "how long did they take" or "when did the
  // signups spike").
  onboardingCompletedAt: timestamp("onboarding_completed_at"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
