import { db, connectorsTable, queueItemsTable, type Connector } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createGmailClient, refreshGmailAccessToken, type GmailTokens } from "@workspace/integration-gmail";
import { encryptToken, decryptToken } from "../crypto";
import { getGroqClient } from "../groq";
import { draftText } from "../draftText";
import { runPoll } from "./pollHelpers";

// Refresh a little before Google's actual expiry, not at it — a poll that
// starts with a token that dies 10 seconds into a multi-call sync fails
// mid-way with no clean retry point, whereas checking against a safety
// margin up front means every call in this poll uses one guaranteed-valid
// token.
const REFRESH_SAFETY_MARGIN_MS = 2 * 60 * 1000;

export async function getValidGmailAccessToken(connector: Connector): Promise<string> {
  if (!connector.oauthTokenRef) throw new Error("Connector has no stored token");
  const tokens = JSON.parse(decryptToken(connector.oauthTokenRef)) as GmailTokens;

  if (tokens.expiresAt - Date.now() > REFRESH_SAFETY_MARGIN_MS) {
    return tokens.accessToken;
  }

  const refreshed = await refreshGmailAccessToken(tokens.refreshToken);
  const nextTokens: GmailTokens = { ...tokens, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
  await db
    .update(connectorsTable)
    .set({ oauthTokenRef: encryptToken(JSON.stringify(nextTokens)) })
    .where(eq(connectorsTable.id, connector.id));
  return nextTokens.accessToken;
}

const DRAFT_SYSTEM_PROMPT =
  "You draft short, direct email replies for a busy founder. Write only the reply body text — no subject line, no greeting-only filler, no sign-off unless natural. 2-5 sentences. Match a professional but plain, non-corporate tone.";

// Gmail's "From" header comes back as "Name <email@x.com>" or a bare
// address — accepting a drafted reply needs the bare address to actually
// send/save the reply to, not the display string.
function extractEmailAddress(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1] : fromHeader.trim();
}

// One poll cycle for one founder's Gmail connector: pull unread threads,
// draft a reply for each via the same lightweight text-drafting path used by
// section 3's instant actions, and drop each into the queue — deduped
// against messageId so re-polling the same inbox never produces repeats.
// Returns the number of NEW queue items created (0 is a normal, common
// result — most polls find nothing unread that wasn't already drafted).
export async function pollGmailConnector(userId: string, connector: Connector): Promise<number> {
  return runPoll(connector, async () => {
    const accessToken = await getValidGmailAccessToken(connector);
    const gmail = await createGmailClient(async () => accessToken);
    const groq = await getGroqClient(userId);

    let created = 0;
    try {
      const threads = await gmail.listUnreadThreads(5);
      for (const thread of threads) {
        let draftBody = `(Reply drafting unavailable — no Groq API key configured. Original: "${thread.snippet}")`;
        if (groq) {
          const drafted = await draftText(
            groq,
            DRAFT_SYSTEM_PROMPT,
            `From: ${thread.from}\nSubject: ${thread.subject}\nMessage: ${thread.snippet}`,
          );
          if (drafted) draftBody = drafted;
        }

        const inserted = await db
          .insert(queueItemsTable)
          .values({
            userId,
            type: "draft_reply",
            source: "gmail",
            title: `Reply drafted for ${thread.from}`,
            body: thread.subject || thread.snippet,
            draftContent: draftBody,
            externalId: thread.messageId,
            metadataJson: JSON.stringify({ threadId: thread.threadId, to: extractEmailAddress(thread.from), subject: thread.subject }),
          })
          .onConflictDoNothing({ target: [queueItemsTable.userId, queueItemsTable.source, queueItemsTable.externalId] })
          .returning({ id: queueItemsTable.id });
        if (inserted.length > 0) created++;
      }
    } finally {
      await gmail.close();
    }

    return created;
  });
}
