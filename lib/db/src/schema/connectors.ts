import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One row per (founder, service) — a founder connecting Gmail and Slack is
// two rows, not one row with an array. Polling, OAuth refresh, and
// disconnect all operate on a single connector at a time, so this keeps
// every operation a plain single-row lookup instead of an array mutation.
//
// oauthTokenRef stores the ENCRYPTED token payload (see lib/crypto.ts
// encryptToken/decryptToken) — a JSON string of { accessToken, refreshToken,
// expiresAt } before encryption, never plaintext at rest. Named "Ref" rather
// than "token" as a reminder to future readers that this column is opaque
// ciphertext, not something to read or log directly.
export const connectorsTable = pgTable(
  "connectors",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),

    // "gmail" | "slack" | "calendar" | "sheets" | "notion" | "instagram" |
    // "whatsapp" — see lib/connectors/registry.ts (api-server) for which of
    // these are actually implemented vs. registered-but-coming-soon.
    type: text("type").notNull(),

    status: text("status").notNull().default("disconnected"), // connected | error | disconnected
    oauthTokenRef: text("oauth_token_ref"),
    lastSyncedAt: timestamp("last_synced_at"),
    // Free-form per-connector settings (e.g. which Sheet id to watch) — kept
    // as a JSON text blob rather than per-service columns for the same
    // "cheap to add a new connector" reason queue_items.source is free text.
    configJson: text("config_json"),

    // Set on the most recent failed poll/refresh so the UI can explain WHY a
    // connector shows "error" instead of just the bare status word. Cleared
    // on the next successful sync.
    lastError: text("last_error"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [uniqueIndex("connectors_user_type_idx").on(table.userId, table.type)],
);

export const insertConnectorSchema = createInsertSchema(connectorsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertConnector = z.infer<typeof insertConnectorSchema>;
export type Connector = typeof connectorsTable.$inferSelect;
