import { pgTable, serial, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// The Dossier — a founder's company file, built once and then kept current.
//
// WHY THIS EXISTS SEPARATELY FROM business_profiles AND company_facts.
// Those two accumulate context INCIDENTALLY, from whatever happens to come
// up in chat: the freeform blob on business_profiles, and one row per
// statement in company_facts. That works, but it means Vera's picture of a
// business is only ever as complete as the questions the founder happened to
// ask. A real consultant does not work that way — they run an intake first,
// notice what you did NOT tell them, and ask for exactly that.
//
// This table is that intake, made durable:
//   sourceText     — what the founder pasted/uploaded (deck text, one-pager,
//                    P&L export, an "about us" page). Kept verbatim so the
//                    extraction can be re-run when the model improves,
//                    without asking the founder for it again.
//   extractedJson  — the structured company picture pulled out of it.
//   questionsJson  — the gaps. Generated FROM the extraction, so they are
//                    personalised to what's actually missing rather than a
//                    fixed onboarding form everyone answers the same way.
//   answersJson    — the founder's answers, keyed by question id.
//
// One active dossier per (user, business profile): a founder juggling two
// businesses gets a file per business, not one blended file — the same
// scoping business_profiles already establishes for every other memory.
export const companyDossiersTable = pgTable(
  "company_dossiers",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    // Nullable for the same reason messages.chatId is: a dossier created
    // before profiles were resolved (or when the profile lookup hiccups) is
    // still worth keeping rather than dropping on the floor.
    profileId: integer("profile_id"),

    sourceText: text("source_text").notNull(),
    // How the source arrived — "paste" or "upload:<filename>". Purely
    // descriptive; nothing branches on it, it's there so a founder looking
    // at their own file can tell where it came from.
    sourceLabel: text("source_label"),

    extractedJson: text("extracted_json").notNull(),
    questionsJson: text("questions_json").notNull(),
    // "{}" until the founder starts answering. Partial answers are normal
    // and expected — the form is not all-or-nothing, and a half-filled
    // dossier is still strictly better than none.
    answersJson: text("answers_json").notNull().default("{}"),

    // "draft" while questions are outstanding, "complete" once the founder
    // has answered everything or explicitly finished. Never blocks use of
    // the dossier — it only drives what the UI nudges about.
    status: text("status").notNull().default("draft"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("company_dossiers_user_id_idx").on(table.userId),
    uniqueIndex("company_dossiers_user_profile_idx").on(table.userId, table.profileId),
  ],
);

export const insertCompanyDossierSchema = createInsertSchema(companyDossiersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCompanyDossier = z.infer<typeof insertCompanyDossierSchema>;
export type CompanyDossier = typeof companyDossiersTable.$inferSelect;
