import { db, queueItemsTable, type Connector } from "@workspace/db";
import { createNotionClient, type NotionTokens } from "@workspace/integration-notion";
import { decryptToken } from "../crypto";
import { runPoll } from "./pollHelpers";

// Notion OAuth tokens for public integrations don't expire — no refresh
// step needed, same as Slack.
export async function pollNotionConnector(userId: string, connector: Connector): Promise<number> {
  return runPoll(connector, async () => {
    if (!connector.oauthTokenRef) throw new Error("Connector has no stored token");
    const tokens = JSON.parse(decryptToken(connector.oauthTokenRef)) as NotionTokens;

    const notion = await createNotionClient(async () => tokens.accessToken);
    let created = 0;
    try {
      const pages = await notion.listRecentlyEditedPages(10);
      for (const page of pages) {
        const inserted = await db
          .insert(queueItemsTable)
          .values({
            userId,
            type: "insight",
            source: "notion",
            title: `Recently edited: ${page.title}`,
            body: `Last edited ${new Date(page.lastEditedTime).toLocaleDateString()} — ${page.url}`,
            externalId: `${page.id}:${page.lastEditedTime}`,
          })
          .onConflictDoNothing({ target: [queueItemsTable.userId, queueItemsTable.source, queueItemsTable.externalId] })
          .returning({ id: queueItemsTable.id });
        if (inserted.length > 0) created++;
      }
    } finally {
      await notion.close();
    }
    return created;
  });
}
