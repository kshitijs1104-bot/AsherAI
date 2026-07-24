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
      const msg = await gmailFetch(accessToken, `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
      return {
        messageId: msg.id,
        threadId: msg.threadId,
        from: header(msg.payload?.headers, "From"),
        subject: header(msg.payload?.headers, "Subject"),
        snippet: msg.snippet ?? "",
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
