import { pgTable, serial, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// The read side of cross-chat memory.
//
// messages.ts says, in its own header, that the raw log exists so "a brand new
// chat [can] ever learn anything from a founder's other chats' raw
// conversation." That was never true. Every row was written correctly — userId
// on every message, an index on user_id for exactly this access pattern — and
// the only reader (messageLog.getRelevantMessages) filters by chatId, so a new
// chat could never see a single word of any other chat. The write side of
// memory was finished; the read side did not exist.
//
// Found live: a founder spent a chat working out that Aurelian should approach
// IITB's VLabs, got the address and a drafted outreach mail, opened a new chat,
// asked what they had discussed, and was told "I don't have a record of our
// previous conversation." Every word of it was sitting in `messages`.
//
// WHY A SUMMARY TABLE RATHER THAN JUST QUERYING messages ACROSS CHATS:
//
//   1. Budget. The free-tier TPM ceiling (8,000) is already smaller than the
//      static system prompt (see groq.ts), which is why getRelevantMessages
//      was cut to 2 recent turns on the narrow path. Injecting raw turns from
//      other chats would spend thousands of tokens the answer needs. A chat
//      compressed to ~70 words costs ~25 tokens, so a founder's whole history
//      fits in the room a single extra precedent used to take.
//
//   2. Lexical retrieval cannot find a conversation from a question ABOUT that
//      conversation. "what did we talk abt on our last chat" tokenizes to
//      talk/last/chat and overlaps nothing in a transcript about lab outreach —
//      recall questions never share vocabulary with what is being recalled.
//      A summary carries the proper nouns (Aurelian, IITB, VLabs) that the raw
//      middle of a transcript buries, and `topics` below exists so those nouns
//      are matchable directly rather than only if they survive into prose.
//
// Rolling and incremental, not rebuilt from scratch: `lastMessageId` is a
// watermark, so each refresh reads the existing summary plus only the turns
// logged since. Cost per turn stays flat as a chat grows to hundreds of
// messages, and a chat that stops being used stops costing anything.
export const chatSummariesTable = pgTable(
  "chat_summaries",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    // One row per chat — see the unique index below. Not a DB-enforced FK,
    // matching every other cross-table reference in this schema.
    chatId: integer("chat_id").notNull(),

    // Snapshot of the chat's title when the summary was last written. Stored
    // rather than joined so recall can render "the chat called X" from one
    // indexed read, and so a summary still names its conversation if the
    // chats row is later renamed underneath it.
    title: text("title").notNull().default(""),

    // The running account of what this conversation was about: what the
    // founder asked, what Vera recommended, what was produced (a drafted
    // mail, a chosen lab, a decided number), and what was left open. Kept
    // short deliberately — see the budget note above.
    summary: text("summary").notNull(),

    // Space-separated distinctive terms and proper nouns from the chat
    // ("aurelian iitb vlabs outreach email ml module"), lowercase. This is
    // the retrieval surface: prose compresses away exactly the named entities
    // a founder later searches by, so they are kept as their own field rather
    // than hoped for inside `summary`.
    topics: text("topics").notNull().default(""),

    // Watermark: the highest messages.id folded into `summary` so far. The
    // next refresh reads only rows above it. Also the concurrency guard — a
    // slower in-flight refresh must never overwrite a newer summary with an
    // older watermark (see chatMemory.ts's upsert).
    lastMessageId: integer("last_message_id").notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),

    // "model" — written by the summariser. "extractive" — a stub built from
    // raw turns with no model call, used so a chat that predates this table
    // (or whose summariser has not run yet) is still recallable immediately
    // instead of being invisible until it happens to be used again. Recorded
    // rather than inferred because the two are not equally trustworthy: an
    // extractive stub is a pair of excerpts, not an account of the chat, and
    // the prompt labels it as such so the model does not read a fragment as
    // the whole conversation.
    source: text("source").notNull().default("model"), // model | extractive

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    // Every retrieval is "this founder's other chats" — userId, then filtered
    // and ranked in memory over a small result set.
    index("chat_summaries_user_id_idx").on(table.userId),
    // One summary per chat, enforced by the database rather than by the
    // refresher remembering to check: two concurrent turns in the same chat
    // both trying to create the first summary is an ordinary race, and the
    // upsert in chatMemory.ts relies on this constraint to resolve it.
    uniqueIndex("chat_summaries_chat_id_key").on(table.chatId),
  ],
);

export const insertChatSummarySchema = createInsertSchema(chatSummariesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertChatSummary = z.infer<typeof insertChatSummarySchema>;
export type ChatSummary = typeof chatSummariesTable.$inferSelect;
