import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Until now, "a chat" only existed as a `ChatSession` object in the frontend's
// localStorage (see vera-nexus/src/lib/venusHistory.ts) — the server had no
// concept of it at all. Every /ai/* route was keyed on `sessionId` (now the
// Clerk userId), which is really "this whole person's account," not "this one
// conversation." That collapse is exactly why a per-chat Goal couldn't exist
// server-side: there was no row to hang it off.
//
// This table is that row. One per chat/thread, owned by a real user. The
// frontend's local chat list becomes a cache/mirror of these rows (and can
// eventually be dropped in favor of always reading from here), and
// venus_decisions / goals both reference chatId so a founder's decision
// history and roadmap can be scoped to "the Aurelian chat" vs "the Vera chat"
// instead of bleeding into one global per-user bucket.
export const chatsTable = pgTable(
  "chats",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull().default("New Chat"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  // Every read of this table filters by userId — GET /chats is the first
  // request the app makes after sign-in, and it ran as a sequential scan.
  // messages, attachments, company_facts and queue_items all had this index
  // already; chats and goals were the two that were missed.
  (table) => [index("chats_user_id_idx").on(table.userId)],
);

export const insertChatSchema = createInsertSchema(chatsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChat = z.infer<typeof insertChatSchema>;
export type Chat = typeof chatsTable.$inferSelect;
