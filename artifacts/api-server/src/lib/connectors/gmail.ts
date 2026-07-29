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
  "You draft short, direct email replies for a busy founder. Write only the reply body text — no subject line, no greeting-only filler, no sign-off unless natural. 2-5 sentences. Match a professional but plain, non-corporate tone. " +
  // The founder edits and sends this — so a draft that invents a commitment
  // is worse than a draft that's too cautious. Only the incoming email is
  // available here (no business context, no memory, no prior thread), so
  // anything the reply asserts beyond it is necessarily made up.
  "You are working from the incoming email ALONE — you have no other knowledge of this founder's business, prior conversations with this person, or their availability. Never invent facts, prices, dates, availability, numbers, or agreements, and never commit the founder to anything they haven't already stated. If the email asks something you cannot answer from its own contents, write a short reply that acknowledges it and asks the one question needed, or leaves the specifics for the founder to fill in — a placeholder the founder completes in five seconds beats a confident sentence they have to catch and delete.";

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
          // WAS `thread.snippet` — Gmail's ~200-character preview, and the
          // only thing this drafter had ever seen. Replying to the first
          // sentence of an email is a fabrication machine: the actual
          // request usually isn't in it, so the model filled the gap. The
          // Gmail client now returns the real decoded body (see
          // integrations/gmail's extractBodyText); snippet stays as the
          // fallback for messages whose body can't be extracted, and the
          // label says which one the model is looking at so it can't
          // mistake a preview for the whole message.
          const hasBody = Boolean(thread.bodyText?.trim());
          const messageBlock = hasBody
            ? `Message body:\n${thread.bodyText}`
            : `Preview only (the full body could not be read — do not assume anything beyond this text):\n${thread.snippet}`;
          const drafted = await draftText(
            groq,
            DRAFT_SYSTEM_PROMPT,
            `From: ${thread.from}\nSubject: ${thread.subject}\n${messageBlock}`,
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
