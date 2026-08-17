import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ---------------------------------------------------------------------------
   What Vera has already nudged this founder about, and when.

   WHY THIS TABLE EXISTS AT ALL. The nudges themselves are DERIVED, not stored —
   lib/nudges.ts recomputes them from real state on every read ("the dossier has
   4 unanswered fields", "3 items have sat on the board for two days"). Storing
   the nudges would immediately make them lie: a founder finishes their dossier
   and a stored "finish your dossier" row would still be sitting there.

   What genuinely has to persist is the part derivation cannot know: WHETHER
   THIS PERSON HAS ALREADY BEEN TOLD, and whether they said no. Without it the
   product has no memory of its own interruptions, which produces the two
   failure modes that make a nudge system worse than none:

     1. The same nudge every three hours forever. A founder who has decided not
        to finish their dossier gets asked about it forty times a week. The
        badge stops meaning "something new" and becomes noise to be cleared
        reflexively — which also destroys the signal for the nudges that DO
        matter.
     2. No way to say no. A dismissal that is not recorded is not a dismissal.

   One row per founder per nudge kind. `lastShownAt` enforces the cooldown,
   `dismissedAt` suppresses a kind the founder has actively rejected, and
   `shownCount` is what lets a nudge give up on itself rather than nagging
   indefinitely — see NUDGE_MAX_SHOWS in lib/nudges.ts.
--------------------------------------------------------------------------- */

export const nudgeStateTable = pgTable(
  "nudge_state",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),

    /** Stable slug identifying WHICH nudge, e.g. "dossier.incomplete". Kept as
     *  free text rather than an enum so adding a nudge is a code change and
     *  not a migration. */
    kind: text("kind").notNull(),

    lastShownAt: timestamp("last_shown_at"),
    shownCount: integer("shown_count").notNull().default(0),

    /** Set when the founder explicitly dismissed this kind. Permanent by
     *  design: "not interested" should not expire after a cooldown and come
     *  back, which is exactly the behaviour that makes people distrust a
     *  product's notifications. */
    dismissedAt: timestamp("dismissed_at"),

    /** Set when the underlying thing was actually DONE (dossier finished,
     *  board cleared). Distinct from dismissed: this one may legitimately
     *  re-arm later if the state regresses, where a dismissal may not. */
    satisfiedAt: timestamp("satisfied_at"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  // One row per (user, kind), upserted — the unique index is what makes
  // onConflictDoUpdate safe on the record-shown path.
  (table) => [uniqueIndex("nudge_state_user_kind_idx").on(table.userId, table.kind)],
);

export const insertNudgeStateSchema = createInsertSchema(nudgeStateTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNudgeState = z.infer<typeof insertNudgeStateSchema>;
export type NudgeState = typeof nudgeStateTable.$inferSelect;
