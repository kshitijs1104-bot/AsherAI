import { db, connectorsTable, queueItemsTable, type Connector } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createSheetsClient, refreshSheetsAccessToken, type SheetsTokens } from "@workspace/integration-google-sheets";
import { encryptToken, decryptToken } from "../crypto";
import { getGroqClient } from "../groq";
import { draftText } from "../draftText";
import { runPoll } from "./pollHelpers";

const REFRESH_SAFETY_MARGIN_MS = 2 * 60 * 1000;

async function getValidAccessToken(connector: Connector): Promise<string> {
  if (!connector.oauthTokenRef) throw new Error("Connector has no stored token");
  const tokens = JSON.parse(decryptToken(connector.oauthTokenRef)) as SheetsTokens;

  if (tokens.expiresAt - Date.now() > REFRESH_SAFETY_MARGIN_MS) return tokens.accessToken;

  const refreshed = await refreshSheetsAccessToken(tokens.refreshToken);
  const nextTokens: SheetsTokens = { ...tokens, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
  await db.update(connectorsTable).set({ oauthTokenRef: encryptToken(JSON.stringify(nextTokens)) }).where(eq(connectorsTable.id, connector.id));
  return nextTokens.accessToken;
}

interface SheetsConfig {
  spreadsheetId: string;
  range: string;
}

const REPORT_SYSTEM_PROMPT =
  "You summarize raw spreadsheet rows into a short weekly business report for a founder. 3-5 plain sentences, lead with the single most important number or trend, no headings or bullet lists.";

// Backs the "weekly-report-sheets" workflow template (see lib/workflows/
// runners.ts) — reads whatever range the founder configured on the
// connector, drafts a plain-language summary, and drops it in the queue.
// Deduped per calendar day: a "sync now" click and the weekly cron landing
// the same day shouldn't produce two nearly-identical reports.
export async function pollSheetsConnector(userId: string, connector: Connector): Promise<number> {
  return runPoll(connector, async () => {
    if (!connector.configJson) {
      throw new Error("No spreadsheet configured for this connector yet — set spreadsheetId and range first.");
    }
    const config: SheetsConfig = JSON.parse(connector.configJson);

    const accessToken = await getValidAccessToken(connector);
    const sheets = await createSheetsClient(async () => accessToken);
    const groq = getGroqClient();

    let created = 0;
    try {
      const rows = await sheets.readRange(config.spreadsheetId, config.range);
      if (rows.length === 0) return 0;

      const rawText = rows.map((row) => row.join(" | ")).join("\n");
      let summary = `(Summary drafting unavailable — no Groq API key configured.)\n\n${rawText.slice(0, 500)}`;
      if (groq) {
        const drafted = await draftText(groq, REPORT_SYSTEM_PROMPT, rawText);
        if (drafted) summary = drafted;
      }

      const today = new Date().toISOString().slice(0, 10);
      const inserted = await db
        .insert(queueItemsTable)
        .values({
          userId,
          type: "report_draft",
          source: "sheets",
          title: "Weekly report drafted from your sheet",
          body: `${rows.length} rows summarized`,
          draftContent: summary,
          externalId: `report-${today}`,
        })
        .onConflictDoNothing({ target: [queueItemsTable.userId, queueItemsTable.source, queueItemsTable.externalId] })
        .returning({ id: queueItemsTable.id });
      if (inserted.length > 0) created++;
    } finally {
      await sheets.close();
    }

    return created;
  });
}
