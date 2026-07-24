import { db, connectorsTable, queueItemsTable, type Connector } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createJiraClient, refreshJiraAccessToken, type JiraTokens } from "@workspace/integration-jira";
import { encryptToken, decryptToken } from "../crypto";
import { runPoll } from "./pollHelpers";

const REFRESH_SAFETY_MARGIN_MS = 2 * 60 * 1000;

async function getValidAccessToken(connector: Connector): Promise<{ accessToken: string; cloudId: string }> {
  if (!connector.oauthTokenRef) throw new Error("Connector has no stored token");
  const tokens = JSON.parse(decryptToken(connector.oauthTokenRef)) as JiraTokens;

  if (tokens.expiresAt - Date.now() > REFRESH_SAFETY_MARGIN_MS) {
    return { accessToken: tokens.accessToken, cloudId: tokens.cloudId };
  }

  // Atlassian rotates the refresh token itself on every use — persisting
  // just a new access token and reusing the old refresh token would break
  // the NEXT refresh, unlike the Google connectors.
  const refreshed = await refreshJiraAccessToken(tokens.refreshToken);
  const nextTokens: JiraTokens = { ...tokens, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, expiresAt: refreshed.expiresAt };
  await db.update(connectorsTable).set({ oauthTokenRef: encryptToken(JSON.stringify(nextTokens)) }).where(eq(connectorsTable.id, connector.id));
  return { accessToken: nextTokens.accessToken, cloudId: nextTokens.cloudId };
}

export async function pollJiraConnector(userId: string, connector: Connector): Promise<number> {
  return runPoll(connector, async () => {
    const { accessToken, cloudId } = await getValidAccessToken(connector);
    const jira = await createJiraClient(async () => accessToken, cloudId);

    let created = 0;
    try {
      const staleIssues = await jira.listStaleIssues(10);
      for (const issue of staleIssues) {
        const inserted = await db
          .insert(queueItemsTable)
          .values({
            userId,
            type: "stale_ticket",
            source: "jira",
            title: `Stale ticket: ${issue.key}`,
            body: `"${issue.summary}" — status ${issue.status}, last updated ${new Date(issue.updated).toLocaleDateString()}`,
            externalId: issue.key,
          })
          .onConflictDoNothing({ target: [queueItemsTable.userId, queueItemsTable.source, queueItemsTable.externalId] })
          .returning({ id: queueItemsTable.id });
        if (inserted.length > 0) created++;
      }
    } finally {
      await jira.close();
    }

    return created;
  });
}
