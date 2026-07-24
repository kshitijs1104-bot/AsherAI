import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// An uploaded image/doc attached to a chat message — the founder picks a
// file in the composer, it uploads immediately (see routes/attachments.ts),
// and the returned row id rides along with the next message they send.
// chatId/messageId are nullable, non-enforced references (same convention
// as messagesTable.chatId) rather than DB foreign keys — an attachment
// uploaded before the message it belongs to even exists (the upload always
// happens first) still gets a durable row.
export const attachmentsTable = pgTable(
  "attachments",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    chatId: integer("chat_id"),
    messageId: integer("message_id"),

    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Relative path under the local uploads directory (see routes/
    // attachments.ts) — never a value derived from user input directly,
    // always a server-generated random filename, so this is never usable
    // for path traversal even if it somehow leaked.
    storagePath: text("storage_path").notNull(),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("attachments_user_id_idx").on(table.userId), index("attachments_chat_id_idx").on(table.chatId)],
);

export const insertAttachmentSchema = createInsertSchema(attachmentsTable).omit({ id: true, createdAt: true });
export type InsertAttachment = z.infer<typeof insertAttachmentSchema>;
export type Attachment = typeof attachmentsTable.$inferSelect;
