import { db, queueItemsTable, type Connector } from "@workspace/db";
import { createSlackClient, type SlackTokens } from "@workspace/integration-slack";
import { decryptToken } from "../crypto";
import { getGroqClient } from "../groq";
import { draftText } from "../draftText";
import { runPoll } from "./pollHelpers";

const DRAFT_SYSTEM_PROMPT =
  "You draft short, direct Slack DM replies for a busy founder. Write only the reply text — casual but professional, 1-3 sentences, no email-style greeting or sign-off.";

// Slack bot tokens from oauth.v2.access don't expire — no refresh step
// needed here, unlike the Google/Jira connectors.
export async function pollSlackConnector(userId: string, connector: Connector): Promise<number> {
  return runPoll(connector, async () => {
    if (!connector.oauthTokenRef) throw new Error("Connector has no stored token");
    const tokens = JSON.parse(decryptToken(connector.oauthTokenRef)) as SlackTokens;

    const slack = await createSlackClient(async () => tokens.accessToken);
    const groq = getGroqClient();

    let created = 0;
    try {
      const dms = await slack.listUnreadDms(10);
      for (const dm of dms) {
        let draftBody = `(Reply drafting unavailable — no Groq API key configured. Original: "${dm.text}")`;
        if (groq) {
          const drafted = await draftText(groq, DRAFT_SYSTEM_PROMPT, `From: ${dm.fromUser}\nMessage: ${dm.text}`);
          if (drafted) draftBody = drafted;
        }

        const inserted = await db
          .insert(queueItemsTable)
          .values({
            userId,
            type: "draft_reply",
            source: "slack",
            title: `Reply drafted for ${dm.fromUser}`,
            body: dm.text,
            draftContent: draftBody,
            externalId: `${dm.channelId}:${dm.text.slice(0, 40)}`,
            metadataJson: JSON.stringify({ channelId: dm.channelId }),
          })
          .onConflictDoNothing({ target: [queueItemsTable.userId, queueItemsTable.source, queueItemsTable.externalId] })
          .returning({ id: queueItemsTable.id });
        if (inserted.length > 0) created++;
      }
    } finally {
      await slack.close();
    }

    return created;
  });
}
