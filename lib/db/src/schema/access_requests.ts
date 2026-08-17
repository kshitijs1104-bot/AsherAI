import { pgTable, serial, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ---- The waitlist, for when signup needs to stop being open ----
//
// Signup is OPEN by default and should stay that way while the beta needs
// volume of real feedback more than it needs filtering. This table is what
// makes closing it a switch rather than a build: set VERA_SIGNUP_MODE=waitlist
// and new accounts land here instead of into the product.
//
// WHY A TABLE AND NOT JUST A CLERK SETTING. Clerk's own restricted mode blocks
// sign-up entirely — the person hits a wall and is gone, and you never learn
// they wanted in. That is the wrong trade for a product still looking for its
// first users: the people who show up during a closed period are exactly the
// ones worth being able to contact. This captures them, tells them honestly
// where they stand, and gives the operator surface a list to approve from.
//
// A row here is NOT an account. Identity still lives entirely in Clerk — this
// records that somebody asked, and whether you said yes. Approving a row is
// what lets their next sign-in through; it does not create anything on their
// behalf.
export const accessRequestsTable = pgTable(
  "access_requests",
  {
    id: serial("id").primaryKey(),

    // Lowercased at the write site so "Jane@Co.com" and "jane@co.com" cannot
    // occupy two rows and get two different answers. The unique index below
    // depends on that normalisation actually happening.
    email: text("email").notNull(),

    // Whatever they told us while asking. Free text, never trusted, shown to
    // the operator as context for the approve/decline call rather than used
    // for anything automatic.
    name: text("name"),
    company: text("company"),
    note: text("note"),

    /** "pending" | "approved" | "declined". Anything else is treated as pending. */
    status: text("status").notNull().default("pending"),

    /** Clerk user id of whoever approved or declined. Null while pending. */
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at"),

    // Set once the approved person actually signs in, so the operator can tell
    // "approved and using it" from "approved and never came back" — the second
    // is a different problem and needs a different follow-up.
    claimedAt: timestamp("claimed_at"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("access_requests_email_idx").on(table.email),
    index("access_requests_status_idx").on(table.status),
  ],
);

export const insertAccessRequestSchema = createInsertSchema(accessRequestsTable).omit({ id: true, createdAt: true });
export type InsertAccessRequest = z.infer<typeof insertAccessRequestSchema>;
export type AccessRequest = typeof accessRequestsTable.$inferSelect;
