import { db, connectorsTable, type QueueItem } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { createGmailClient } from "@workspace/integration-gmail";
import { createSlackClient, type SlackTokens } from "@workspace/integration-slack";
import { createLinkedinClient, type LinkedinTokens } from "@workspace/integration-linkedin";
import { decryptToken } from "../crypto";
import { getValidGmailAccessToken } from "./gmail";

async function getConnector(userId: string, type: string) {
  const [connector] = await db
    .select()
    .from(connectorsTable)
    .where(and(eq(connectorsTable.userId, userId), eq(connectorsTable.type, type)))
    .limit(1);
  if (!connector || connector.status !== "connected") {
    throw new Error(`${type} isn't connected — reconnect it to send this.`);
  }
  return connector;
}

// Called from routes/queue.ts right after an item is marked accepted/edited
// — the one place a queue item's draft actually leaves our own database and
// does the real-world thing it represents (save a Gmail draft, post a Slack
// reply, publish a LinkedIn post). Item types/sources with nothing to send
// (an insight, an automation suggestion, a plain alert) just no-op here;
// "accepting" them only ever meant "I've seen this."
export async function performQueueItemSendAction(userId: string, item: QueueItem): Promise<void> {
  if (!item.draftContent) return;

  if (item.source === "gmail" && item.metadataJson) {
    const { threadId, to, subject } = JSON.parse(item.metadataJson) as { threadId: string; to: string; subject: string };
    const connector = await getConnector(userId, "gmail");
    const accessToken = await getValidGmailAccessToken(connector);
    const gmail = await createGmailClient(async () => accessToken);
    try {
      await gmail.createDraftReply({ threadId, to, subject, bodyText: item.draftContent });
    } finally {
      await gmail.close();
    }
    return;
  }

  if (item.source === "slack" && item.metadataJson) {
    const { channelId } = JSON.parse(item.metadataJson) as { channelId: string };
    const connector = await getConnector(userId, "slack");
    if (!connector.oauthTokenRef) throw new Error("Slack connector has no stored token");
    const tokens = JSON.parse(decryptToken(connector.oauthTokenRef)) as SlackTokens;
    const slack = await createSlackClient(async () => tokens.accessToken);
    try {
      await slack.postMessage(channelId, item.draftContent);
    } finally {
      await slack.close();
    }
    return;
  }

  if (item.source === "linkedin") {
    const connector = await getConnector(userId, "linkedin");
    if (!connector.oauthTokenRef) throw new Error("LinkedIn connector has no stored token");
    const tokens = JSON.parse(decryptToken(connector.oauthTokenRef)) as LinkedinTokens;
    const linkedin = await createLinkedinClient(async () => tokens.accessToken, tokens.authorUrn);
    try {
      await linkedin.createPost(item.draftContent);
    } finally {
      await linkedin.close();
    }
    return;
  }

  // Every other source (instant_action, notion, jira, calendar, workflow,
  // sheets) has no live send step — its "draft" is either informational or
  // already fully represented by the queue item itself.
}
