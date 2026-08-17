import { db, chatSummariesTable, chatsTable, messagesTable, type ChatSummary, type Message } from "@workspace/db";
import { and, desc, eq, gt, inArray, lt, lte } from "drizzle-orm";
import { tokenize } from "./retrieval";
import { callGroqJSON, getGroqClient } from "./groq";

/* ---------------------------------------------------------------------------
   CROSS-CHAT MEMORY

   What this closes: everything a founder said lived in `messages`, correctly
   keyed on userId, and the only reader filtered by chatId — so opening a new
   chat put Vera back at zero. A founder who had spent a chat deciding to
   approach IITB's VLabs, collected the address and had the outreach mail
   drafted, opened a new chat, asked what they had discussed, and got "I don't
   have a record of our previous conversation."

   Two halves, and the second is the one that is easy to get wrong:

     WRITE — after each turn, fold the new messages into a short rolling
     summary of that chat (ensureChatSummary). Incremental, so cost per turn
     does not grow with the chat.

     READ — when answering, put the summaries of this founder's OTHER chats in
     front of the model (buildCrossChatMemoryBlock).

   The read half cannot be pure lexical matching, which is what every other
   retrieval path in this codebase uses. "what did we talk abt on our last chat
   abt some IIT" tokenizes to talk/last/chat/iit and overlaps almost nothing in
   a conversation about lab outreach and a drafted email: a question ABOUT a
   conversation does not share vocabulary WITH it. So recall-shaped questions
   are routed by recency instead of by overlap — see looksLikeRecallQuestion.
   Ordinary questions still use overlap, because there the founder is asking
   about a subject and the subject is what should decide relevance.
--------------------------------------------------------------------------- */

const SUMMARY_MODEL = "openai/gpt-oss-20b";

// Same reasoning as queryClassifier.ts's choice of the same model: gpt-oss-20b
// draws on a TPM pool separate from the gpt-oss-120b pool the founder's actual
// answer spends. Maintaining memory therefore costs latency on a fire-and-
// forget path, never a token of the budget that was already the binding
// constraint on answer quality.

// How many new messages must have accumulated before a chat is re-summarised.
// 2 = every turn (one user + one assistant message), which is deliberate: the
// most common cross-chat recall is about the conversation the founder just
// left, so a summary that lags a turn behind misses precisely the case this
// exists for. The refresh is incremental (existing summary + only the new
// turns), so paying it every turn is a few hundred tokens on a pool with room,
// not a rebuild.
const MIN_NEW_MESSAGES_TO_REFRESH = 2;

// Caps on what one refresh reads, so a chat that has gone a long time without
// a refresh (or a backfill of a long pre-existing chat) can't assemble an
// unbounded prompt.
const MAX_NEW_MESSAGES_PER_REFRESH = 30;
const MAX_CHARS_PER_MESSAGE = 600;

const SUMMARY_SYSTEM_PROMPT = `You maintain Vera's running memory of ONE conversation between Vera (a business advisor) and a founder. You are given the memory so far and the newest turns. Return the updated memory.

What the summary is for: months later, in a completely different chat, the founder asks "what did we decide about X" or "remind me who you said to contact". Your summary is the only thing Vera will have. Write it so that question is answerable.

Rules:
- 70 words maximum. Dense, plain sentences. No preamble, no "in this conversation".
- Record: what the founder is working on, what they asked, what Vera concluded or recommended, anything Vera PRODUCED (a drafted email, a chosen option, a named contact), and anything left open or unresolved.
- Keep proper nouns, names, organisations, email addresses, URLs and numbers EXACTLY as they appear. These are what the founder will search by later. Never generalise "IITB VLabs (support@vlabs.co.in)" into "a university lab".
- Never add anything the turns do not say. If the new turns add nothing meaningful, return the previous summary unchanged.
- Write it as a record of what happened, not advice to the founder. No second person.

"topics" is a space-separated list of up to 25 lowercase distinctive terms from the WHOLE conversation — proper nouns, organisations, products, people, and the subjects covered. This is a search index, not a sentence: no punctuation, no common words, and never drop a name that appears in the summary.

Return ONLY this JSON:
{"summary": "...", "topics": "term term term"}`;

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/**
 * A synopsis built with no model call: the founder's opening message and the
 * most recent exchange, verbatim-ish.
 *
 * This exists so that cross-chat memory works from the moment it ships rather
 * than only for conversations that happen afterwards. Every chat a founder
 * already has predates the summariser; without a zero-cost path they would all
 * be invisible until each one happened to be used again, which for a finished
 * conversation is never. It is also the honest degradation when the model call
 * fails — a pair of real excerpts beats no memory at all.
 *
 * It is NOT an account of the conversation, and is stored with source
 * "extractive" so the prompt can say so rather than letting the model read two
 * fragments as the whole chat.
 */
export function extractiveSynopsis(messages: { role: string; content: string }[]): string {
  if (messages.length === 0) return "";
  const firstUser = messages.find((m) => m.role === "user");
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const lastUser = [...messages].reverse().find((m) => m.role === "user" && m !== firstUser);

  const parts: string[] = [];
  if (firstUser) parts.push(`Opened with: "${truncate(firstUser.content, 220)}"`);
  if (lastUser) parts.push(`Later asked: "${truncate(lastUser.content, 200)}"`);
  if (lastAssistant) parts.push(`Vera's last answer: "${truncate(lastAssistant.content, 260)}"`);
  return parts.join(" ");
}

// Cheap topic index for an extractive stub: the distinctive tokens of the
// chat, deduped, most-frequent-first. Uses the same tokenize()/stopword pass
// the rest of retrieval uses, so a stub and a model summary are scored on the
// same footing.
function extractiveTopics(messages: { content: string }[], limit = 25): string {
  const counts = new Map<string, number>();
  for (const m of messages) {
    for (const t of tokenize(m.content)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([t]) => t)
    .join(" ");
}

/**
 * Write a summary row, without letting a slow refresh clobber a newer one.
 *
 * Two turns in the same chat can be in flight at once, and the unique index on
 * chat_id means the second one's INSERT loses. Resolving that with a blind
 * UPDATE would let whichever request finishes last win, which is not the same
 * as whichever request saw more of the conversation — a refresh that started
 * earlier and read fewer messages would overwrite a more complete summary and
 * move the watermark backwards. The update is therefore guarded on the
 * watermark strictly increasing.
 */
async function upsertSummary(
  row: {
    userId: string;
    chatId: number;
    title: string;
    summary: string;
    topics: string;
    lastMessageId: number;
    messageCount: number;
    source: string;
    // When this CONVERSATION was last active — not when this row was written.
    // Recall ranks by recency, so stamping now() here would make every chat
    // backfilled in one pass look equally recent and destroy the ordering that
    // answers "what did we talk about last time". Taken from the last message
    // folded in, which is the only timestamp that means what recency means.
    updatedAt: Date;
  },
  // An UPGRADE replaces an extractive stub with a real summary of the same
  // turns, so it does not advance the watermark and would be rejected by the
  // strictly-increasing guard. It is the one write allowed to land at an
  // unchanged watermark.
  opts: { upgrade?: boolean } = {},
): Promise<void> {
  const inserted = await db
    .insert(chatSummariesTable)
    .values(row)
    .onConflictDoNothing({ target: chatSummariesTable.chatId })
    .returning({ id: chatSummariesTable.id });
  if (inserted.length > 0) return;

  await db
    .update(chatSummariesTable)
    .set({
      title: row.title,
      summary: row.summary,
      topics: row.topics,
      lastMessageId: row.lastMessageId,
      messageCount: row.messageCount,
      source: row.source,
      updatedAt: row.updatedAt,
    })
    .where(
      and(
        eq(chatSummariesTable.chatId, row.chatId),
        opts.upgrade
          ? lte(chatSummariesTable.lastMessageId, row.lastMessageId)
          : lt(chatSummariesTable.lastMessageId, row.lastMessageId),
      ),
    );
}

/**
 * Replace an extractive stub with a real summary of the same conversation.
 *
 * Without this, a FINISHED chat is stuck as excerpts forever: the backfill
 * writes a stub, the refresher only runs when new turns arrive, and a
 * conversation the founder has stopped using never gets any. That is exactly
 * the chat they are most likely to ask about later — the one where something
 * was decided and then left. Fire-and-forget, so the recall request that
 * triggered the backfill is never made to wait on it.
 */
async function upgradeExtractiveSummary(userId: string, chatId: number, title: string): Promise<void> {
  try {
    const groq = getGroqClient();
    if (!groq) return;

    // The tail of the conversation, not its head: where a chat ends is where
    // its conclusions are. A chat longer than this cap loses its opening to
    // the summary, which is the right half to lose — and once the founder uses
    // it again the incremental refresher takes over from the watermark.
    const recent = await db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.userId, userId), eq(messagesTable.chatId, chatId)))
      .orderBy(desc(messagesTable.id))
      .limit(MAX_NEW_MESSAGES_PER_REFRESH);
    if (recent.length === 0) return;
    const messages = recent.reverse();

    const transcript = messages
      .map((m) => `${m.role === "user" ? "Founder" : "Vera"}: ${truncate(m.content, MAX_CHARS_PER_MESSAGE)}`)
      .join("\n");
    const { parsed } = await callGroqJSON(
      groq,
      {
        model: SUMMARY_MODEL,
        messages: [
          { role: "system", content: SUMMARY_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Memory so far: (nothing yet — summarise this conversation from the turns below)\n\nNew turns:\n"""\n${transcript}\n"""`,
          },
        ],
        temperature: 0,
        max_tokens: 400,
        reasoning_effort: "low",
        include_reasoning: false,
      },
      "chatSummaryUpgrade",
    );

    const summary = typeof parsed?.summary === "string" ? parsed.summary.trim() : "";
    if (!summary) return; // the stub already in place stays; nothing is lost

    const topics = typeof parsed?.topics === "string" ? parsed.topics.trim() : "";
    await upsertSummary(
      {
        userId,
        chatId,
        title,
        summary: truncate(summary, 900),
        topics: mergeTopics(extractiveTopics(messages), topics),
        lastMessageId: messages[messages.length - 1].id,
        messageCount: messages.length,
        source: "model",
        // The conversation's own last-active time, not now(). An upgrade
        // improves the record of an old chat; it does not make that chat
        // recent, and treating it as recent would push a months-old thread to
        // the top of the next recall answer.
        updatedAt: messages[messages.length - 1].createdAt ?? new Date(),
      },
      { upgrade: true },
    );
  } catch (err) {
    console.error("[chatMemory] failed to upgrade an extractive summary, leaving the excerpt stub in place", err);
  }
}

/**
 * Fold everything logged since the last watermark into this chat's summary.
 *
 * Fire-and-forget from the request path and never throws, matching the
 * philosophy already established in messageLog.ts and companyMemory.ts:
 * maintaining memory must never be able to break the answer the founder is
 * actually waiting on.
 */
export async function ensureChatSummary(userId: string, chatId: number | undefined): Promise<void> {
  if (!chatId) return;
  try {
    const [existing] = await db
      .select()
      .from(chatSummariesTable)
      .where(and(eq(chatSummariesTable.userId, userId), eq(chatSummariesTable.chatId, chatId)))
      .limit(1);

    const watermark = existing?.lastMessageId ?? 0;
    const fresh = await db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.userId, userId), eq(messagesTable.chatId, chatId), gt(messagesTable.id, watermark)))
      .orderBy(messagesTable.id)
      .limit(MAX_NEW_MESSAGES_PER_REFRESH);

    if (fresh.length === 0) return;
    if (existing && fresh.length < MIN_NEW_MESSAGES_TO_REFRESH) return;

    const [chat] = await db
      .select({ title: chatsTable.title })
      .from(chatsTable)
      .where(and(eq(chatsTable.userId, userId), eq(chatsTable.id, chatId)))
      .limit(1);
    const title = chat?.title ?? existing?.title ?? "";

    const newWatermark = fresh[fresh.length - 1].id;
    const messageCount = (existing?.messageCount ?? 0) + fresh.length;
    const lastActiveAt = fresh[fresh.length - 1].createdAt ?? new Date();

    const groq = getGroqClient();
    if (!groq) {
      // No key configured. Still write an extractive row rather than nothing:
      // an unsummarised chat that is at least recallable is worth more than a
      // chat that does not exist as far as every future conversation is
      // concerned.
      await upsertSummary({
        userId,
        chatId,
        title,
        summary: truncate([existing?.summary ?? "", extractiveSynopsis(fresh)].filter(Boolean).join(" "), 900),
        topics: extractiveTopics(fresh),
        lastMessageId: newWatermark,
        messageCount,
        source: "extractive",
        updatedAt: lastActiveAt,
      });
      return;
    }

    const transcript = fresh
      .map((m) => `${m.role === "user" ? "Founder" : "Vera"}: ${truncate(m.content, MAX_CHARS_PER_MESSAGE)}`)
      .join("\n");
    const priorBlock = existing?.summary
      ? `Memory so far:\n${existing.summary}\n\nExisting topics: ${existing.topics}\n\n`
      : "Memory so far: (nothing yet — this is the start of the conversation)\n\n";

    const { parsed } = await callGroqJSON(
      groq,
      {
        model: SUMMARY_MODEL,
        messages: [
          { role: "system", content: SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: `${priorBlock}New turns:\n"""\n${transcript}\n"""` },
        ],
        temperature: 0,
        max_tokens: 400,
        reasoning_effort: "low",
        include_reasoning: false,
      },
      "chatSummary",
    );

    const summary = typeof parsed?.summary === "string" ? parsed.summary.trim() : "";
    if (!summary) {
      // The model failed or returned nothing usable. Fall back to excerpts
      // rather than skipping the write: skipping leaves the watermark where it
      // is, so the same turns are re-read and re-fail on the next refresh, and
      // the chat stays unrecallable the whole time.
      await upsertSummary({
        userId,
        chatId,
        title,
        summary: truncate(existing?.summary || extractiveSynopsis(fresh), 900),
        topics: existing?.topics || extractiveTopics(fresh),
        lastMessageId: newWatermark,
        messageCount,
        source: "extractive",
        updatedAt: lastActiveAt,
      });
      return;
    }

    const topics = typeof parsed?.topics === "string" ? parsed.topics.trim() : "";
    await upsertSummary({
      userId,
      chatId,
      title,
      summary: truncate(summary, 900),
      // Union with what was already indexed: the model sees only the new turns
      // and the prose summary, so terms from earlier in a long chat would
      // otherwise silently drop out of the search index as the chat grows.
      topics: mergeTopics(existing?.topics ?? "", topics || extractiveTopics(fresh)),
      lastMessageId: newWatermark,
      messageCount,
      source: "model",
      updatedAt: lastActiveAt,
    });
  } catch (err) {
    console.error("[chatMemory] failed to refresh chat summary, continuing without it (has the chat_summaries migration been run?)", err);
  }
}

function mergeTopics(existing: string, incoming: string, limit = 40): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of `${incoming} ${existing}`.toLowerCase().split(/[\s,]+/)) {
    const clean = term.replace(/[^a-z0-9@.\-]/g, "");
    if (clean.length < 2 || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out.join(" ");
}

/* ---- Recall intent ---------------------------------------------------- */

// A question ABOUT a past conversation, as opposed to a question about a
// subject. This distinction is the whole reason cross-chat memory needs its
// own routing: lexical overlap ranks by shared vocabulary, and these questions
// share none with the thing they are asking for. "what did we talk abt on our
// last chat abt some IIT i dont remember if u cld remind me" survives
// tokenization as roughly talk/last/chat/iit/remember/remind — against a
// transcript about lab outreach, an outreach portal and a drafted mail, that
// scores at or near zero. Ranked by overlap it would be dropped; ranked by
// recency it is the first thing a founder should get back.
//
// Deliberately over-inclusive. A false positive shows the model two or three
// extra 25-token summaries it correctly ignores; a false negative is Vera
// telling a founder it has no record of a conversation that is sitting in the
// database, which is the failure this whole module exists to end.
const RECALL_PATTERNS: RegExp[] = [
  // Direct appeals to memory: "remind me", "do you remember", "you forgot".
  /\b(remind me|jog my memory|do (you|u) remember|d(o|id) (you|u) recall|(you|u) (remember|forgot|told me|said|mentioned))\b/i,
  // "what did we talk about", "who did you say", "which lab did we pick" —
  // an interrogative aimed at a past speech act rather than at a subject.
  /\b(what|who|which|where|when|how)\b.{0,40}\b(we|i|you|u)\b.{0,25}\b(talk|talked|discuss|discussed|say|said|said about|tell|told|spoke|speak|cover|covered|decide|decided|agree|agreed|conclude|concluded|recommend|recommended|suggest|suggested|draft|drafted)\b/i,
  // Explicit reference to another conversation.
  /\b(last|previous|earlier|prior|other|another|old|first|that)\s+(chat|conversation|convo|session|thread|discussion|analysis)\b/i,
  /\b(in|from|on|during)\s+(our|the|my|that)\s+(last|previous|earlier|prior|other|first)\b/i,
  // "did we ever talk about", "have we discussed".
  /\b(did|have|had|didn'?t|haven'?t)\s+(we|i|you|u)\s+(ever\s+)?(talk|talked|discuss|discussed|speak|spoke|cover|covered|decide|decided|go over|went over)\b/i,
  // Time-anchored recall: "we discussed this before / earlier / last time".
  /\b(we|i|you|u)\s+\w{0,12}\s?(talked|discussed|spoke|said|told|mentioned|decided|agreed)\b.{0,30}\b(before|earlier|previously|last time|the other day|yesterday|last week)\b/i,
  // Bare "our last chat" / "our previous conversation" with no verb at all.
  /\bour\s+(last|previous|earlier|prior|first)\b/i,
];

export function looksLikeRecallQuestion(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return RECALL_PATTERNS.some((re) => re.test(text));
}

/* ---- Retrieval -------------------------------------------------------- */

// How many other chats can appear in one prompt. A recall question gets more
// room because for that question the block IS the answer; an ordinary question
// gets fewer because there the block is supporting context competing with the
// dossier, the precedents and the founder's own decisions.
const RECALL_MAX_CHATS = 4;
const TOPICAL_MAX_CHATS = 3;
// Same floor as messageLog.ts's MIN_RELEVANCE_OVERLAP, for the same reason: a
// single coincidental shared word must not be able to drag an unrelated
// conversation into the prompt.
const MIN_TOPICAL_OVERLAP = 2;
// How many of a founder's chats are considered at all. Ranking happens in
// memory over this set; a founder with hundreds of chats still does one
// indexed read.
const MAX_SUMMARIES_SCANNED = 30;
// Chats with no summary row yet that one request will backfill (see
// extractiveSynopsis). Bounded because this is the one query here that reads
// raw message bodies.
const MAX_BACKFILL_CHATS = 5;
const MAX_BACKFILL_MESSAGES = 240;

export interface CrossChatMemory {
  block: string;
  recallIntent: boolean;
  chatsUsed: number;
}

const EMPTY: CrossChatMemory = { block: "", recallIntent: false, chatsUsed: 0 };

/**
 * Give any of this founder's chats that have never been summarised a zero-cost
 * extractive stub, so they are recallable now instead of after they next
 * happen to be used. Runs at most once per chat in practice — the row it
 * writes is what stops it being selected again.
 */
async function backfillMissingSummaries(userId: string, summarised: Set<number>): Promise<ChatSummary[]> {
  const chats = await db
    .select({ id: chatsTable.id, title: chatsTable.title, updatedAt: chatsTable.updatedAt })
    .from(chatsTable)
    .where(eq(chatsTable.userId, userId))
    .orderBy(desc(chatsTable.updatedAt))
    .limit(MAX_SUMMARIES_SCANNED);

  const missing = chats.filter((c) => !summarised.has(c.id)).slice(0, MAX_BACKFILL_CHATS);
  if (missing.length === 0) return [];

  const rows = await db
    .select()
    .from(messagesTable)
    .where(and(eq(messagesTable.userId, userId), inArray(messagesTable.chatId, missing.map((c) => c.id))))
    .orderBy(messagesTable.id)
    .limit(MAX_BACKFILL_MESSAGES);

  const byChat = new Map<number, Message[]>();
  for (const row of rows) {
    if (row.chatId === null) continue;
    const list = byChat.get(row.chatId) ?? [];
    list.push(row);
    byChat.set(row.chatId, list);
  }

  const built: ChatSummary[] = [];
  for (const chat of missing) {
    const messages = byChat.get(chat.id);
    if (!messages || messages.length === 0) continue;
    const row = {
      userId,
      chatId: chat.id,
      title: chat.title ?? "",
      summary: truncate(extractiveSynopsis(messages), 900),
      topics: extractiveTopics(messages),
      lastMessageId: messages[messages.length - 1].id,
      messageCount: messages.length,
      source: "extractive",
      // chats.updatedAt is only bumped on rename (see routes/chats.ts), so the
      // last message's own timestamp is the only honest answer to "when was
      // this conversation last active" — and recall ranks on exactly that.
      updatedAt: messages[messages.length - 1].createdAt ?? chat.updatedAt ?? new Date(),
    };
    await upsertSummary(row);
    built.push({ id: 0, createdAt: row.updatedAt, ...row } as ChatSummary);
    // The stub answers THIS request; the real summary lands for the next one.
    // Deliberately not awaited — a founder asking what they discussed should
    // not wait on a model call per unsummarised chat.
    void upgradeExtractiveSummary(userId, chat.id, row.title);
  }
  return built;
}

/**
 * Which of this founder's other chats belong in the prompt for THIS message.
 *
 * Pure, and exported, because it is the part that has to be right: the two
 * branches below are the difference between answering "what did we decide last
 * time" and telling the founder there is no record of it. Kept free of the
 * database so the ranking can be tested against real messages directly.
 */
export function rankChatMemories(
  summaries: ChatSummary[],
  message: string,
  recallIntent: boolean,
): ChatSummary[] {
  const queryTokens = new Set(tokenize(message));
  const scored = summaries.map((s) => {
    const haystack = new Set(tokenize(`${s.title} ${s.topics} ${s.summary}`));
    let overlap = 0;
    for (const t of queryTokens) if (haystack.has(t)) overlap++;
    return { summary: s, overlap };
  });

  const byRecency = (a: { summary: ChatSummary }, b: { summary: ChatSummary }) =>
    new Date(b.summary.updatedAt ?? 0).getTime() - new Date(a.summary.updatedAt ?? 0).getTime();

  if (recallIntent) {
    // Recency first, overlap only as a tie-break, and zero-overlap chats are
    // deliberately KEPT. A founder asking what was discussed last time is
    // asking about the most recent conversation, and the words they ask it
    // with carry no signal about which one — see RECALL_PATTERNS. Ranking
    // these by overlap would drop the correct answer for scoring zero.
    return scored
      .sort((a, b) => b.overlap - a.overlap || byRecency(a, b))
      .slice(0, RECALL_MAX_CHATS)
      .sort(byRecency)
      .map((s) => s.summary);
  }

  // An ordinary question is about a subject, so the subject decides relevance
  // and an unrelated conversation must not be dragged in on one shared word.
  return scored
    .filter((s) => s.overlap >= MIN_TOPICAL_OVERLAP)
    .sort((a, b) => b.overlap - a.overlap || byRecency(a, b))
    .slice(0, TOPICAL_MAX_CHATS)
    .map((s) => s.summary);
}

export function formatChatMemory(summaries: ChatSummary[], charBudget: number): string {
  const rendered: string[] = [];
  let spent = 0;
  for (const s of summaries) {
    const when = s.updatedAt ? new Date(s.updatedAt).toISOString().slice(0, 10) : "date unknown";
    const label = s.title?.trim() ? `"${truncate(s.title, 60)}"` : `chat #${s.chatId}`;
    const kind = s.source === "extractive" ? ", not yet condensed — excerpts only" : "";
    const entry = `[Chat ${label} — last active ${when}, ${s.messageCount} messages${kind}]\n${s.summary}`;
    if (spent + entry.length > charBudget && rendered.length > 0) break;
    rendered.push(entry);
    spent += entry.length;
  }
  if (rendered.length === 0) return "";
  return (
    "OTHER CONVERSATIONS WITH THIS FOUNDER (your own memory of their other chats in this account — real records of things that were actually said, not guesses):\n\n" +
    rendered.join("\n\n")
  );
}

/**
 * The founder's other chats, condensed, ranked for THIS message.
 *
 * Never throws — a memory lookup failing must degrade to "no cross-chat
 * context" rather than take down the answer (same contract as
 * retrieveOwnResolvedDecisions in retrieval.ts).
 */
export async function buildCrossChatMemory(
  userId: string,
  currentChatId: number | undefined,
  message: string,
  opts: { charBudget: number },
): Promise<CrossChatMemory> {
  const recallIntent = looksLikeRecallQuestion(message);
  try {
    const stored = await db
      .select()
      .from(chatSummariesTable)
      .where(eq(chatSummariesTable.userId, userId))
      .orderBy(desc(chatSummariesTable.updatedAt))
      .limit(MAX_SUMMARIES_SCANNED);

    let all = stored;
    // Backfilling costs a read of raw message bodies, so it is only worth
    // doing when the founder is actually reaching for their history. On an
    // ordinary question the summariser will get to those chats on its own.
    if (recallIntent) {
      const backfilled = await backfillMissingSummaries(userId, new Set(stored.map((s) => s.chatId)));
      all = [...stored, ...backfilled];
    }

    // The current chat is excluded unconditionally: its own turns are already
    // in the prompt as real message history, in full, so a summary of it would
    // be a second, worse copy competing for the same budget.
    const others = all.filter((s) => s.chatId !== currentChatId && s.summary?.trim());
    if (others.length === 0) return { ...EMPTY, recallIntent };

    const selected = rankChatMemories(others, message, recallIntent);
    if (selected.length === 0) return { ...EMPTY, recallIntent };
    const block = formatChatMemory(selected, opts.charBudget);
    return { block, recallIntent, chatsUsed: block ? selected.length : 0 };
  } catch (err) {
    console.error("[chatMemory] cross-chat lookup failed, answering without it (has the chat_summaries migration been run?)", err);
    return { ...EMPTY, recallIntent };
  }
}

/**
 * Every chat this founder has, condensed — for the "what have we talked about"
 * case where nothing narrows it down. Exported for routes that want to render
 * memory directly rather than feed it to a prompt.
 */
export async function listChatMemory(userId: string, limit = MAX_SUMMARIES_SCANNED): Promise<ChatSummary[]> {
  try {
    return await db
      .select()
      .from(chatSummariesTable)
      .where(eq(chatSummariesTable.userId, userId))
      .orderBy(desc(chatSummariesTable.updatedAt))
      .limit(limit);
  } catch (err) {
    console.error("[chatMemory] failed to list chat summaries", err);
    return [];
  }
}
