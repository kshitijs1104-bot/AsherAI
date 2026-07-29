// Deliberately hand-rolled REST calls against the Gmail API rather than the
// `googleapis` package — that package vendors typed clients for every
// Google API and is enormous for the ~3 endpoints this connector actually
// needs. A short-lived, per-poll access token is passed into every call
// here rather than held on a client instance, matching oauth.ts's
// no-token-lives-longer-than-one-call posture.
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmailFetch(accessToken: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail API ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

function header(headers: { name: string; value: string }[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export interface UnreadThreadSummary {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  // The actual message body, plain text, truncated (see BODY_CHAR_LIMIT).
  // ADDED because `snippet` alone — Gmail's ~200-character preview — was the
  // ONLY thing the auto-reply drafter ever saw (see the api-server's
  // pollGmailConnector). Vera was drafting replies to emails it had read the
  // first sentence of, which is a guaranteed source of invented content: the
  // actual ask is almost never in the first 200 characters. Empty string
  // when the body can't be extracted, in which case callers should fall
  // back to `snippet` and say so rather than pretending they have more.
  bodyText: string;
}

// Gmail returns message bodies as base64url inside a (possibly deeply
// nested) MIME part tree. Prefer text/plain; fall back to text/html with
// tags stripped, since plenty of senders ship HTML-only mail.
function decodePart(data: string | undefined): string {
  if (!data) return "";
  try {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function collectBody(payload: any, wanted: string): string {
  if (!payload) return "";
  if (payload.mimeType === wanted && payload.body?.data) return decodePart(payload.body.data);
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const found = collectBody(part, wanted);
      if (found) return found;
    }
  }
  return "";
}

// Enough for the model to understand what is actually being asked without
// dragging a 40KB quoted thread into a drafting prompt on a shared TPM pool.
const BODY_CHAR_LIMIT = 4000;

function extractBodyText(payload: any): string {
  const plain = collectBody(payload, "text/plain");
  const raw = plain || collectBody(payload, "text/html").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  const cleaned = raw
    // Drop quoted history and signature blocks — for a REPLY draft, what
    // matters is the new message, and the quoted chain is mostly duplicate
    // tokens that crowd out the part that needs answering.
    .split(/\n\s*(?:On .+ wrote:|-{2,}\s*Original Message|_{5,})/)[0]
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length > BODY_CHAR_LIMIT ? `${cleaned.slice(0, BODY_CHAR_LIMIT)}\n…[truncated]` : cleaned;
}

// Only the first page, newest-first (Gmail's default order) — a connector
// poll is meant to surface what's NEW since last sync, not paginate a whole
// inbox; queue_items' externalId-based dedupe (see the api-server poller)
// is what keeps re-polling the same top N cheap and safe.
export async function listUnreadThreads(accessToken: string, maxResults = 10): Promise<UnreadThreadSummary[]> {
  const list = await gmailFetch(accessToken, `/messages?q=${encodeURIComponent("is:unread in:inbox")}&maxResults=${maxResults}`);
  const ids: string[] = (list.messages ?? []).map((m: any) => m.id);

  return Promise.all(
    ids.map(async (id) => {
      // format=full, not format=metadata: metadata returns headers and the
      // snippet only, which is why nothing downstream could ever see the
      // real message. Same single request per message either way.
      const msg = await gmailFetch(accessToken, `/messages/${id}?format=full`);
      return {
        messageId: msg.id,
        threadId: msg.threadId,
        from: header(msg.payload?.headers, "From"),
        subject: header(msg.payload?.headers, "Subject"),
        snippet: msg.snippet ?? "",
        bodyText: extractBodyText(msg.payload),
      };
    }),
  );
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Creates a DRAFT, never sends — the founder still has to hit send in
// Gmail (or accept via Command Center, once that write-back exists), same
// "Vera drafts, the founder decides" contract every other queue item honors.
export async function createDraftReply(
  accessToken: string,
  params: { threadId: string; to: string; subject: string; bodyText: string },
): Promise<{ draftId: string }> {
  const subject = params.subject.toLowerCase().startsWith("re:") ? params.subject : `Re: ${params.subject}`;
  const raw = [`To: ${params.to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", params.bodyText].join("\r\n");

  const draft = await gmailFetch(accessToken, "/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { threadId: params.threadId, raw: toBase64Url(raw) } }),
  });
  return { draftId: draft.id };
}
