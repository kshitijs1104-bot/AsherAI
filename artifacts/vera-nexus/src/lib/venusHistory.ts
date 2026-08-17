export type SavedAnalysisType = 'risk' | 'roadmap' | 'pattern' | 'fundraising' | 'competitive' | 'analysis';

export interface SavedAnalysis {
  id: string;
  type: SavedAnalysisType;
  title: string;
  summary: string;
  savedAt: string;
  // Full response data needed to actually reopen/re-render this analysis later.
  // Previously only title/summary were stored, so a saved item could be listed
  // but never reopened — there was no data to render back into the chat view.
  cards?: any[];
  confidence?: 'verified' | 'exploratory';
  confidenceNote?: string;
  contextQuery?: string;
  // The chat this analysis was saved OUT of, so the Saved Analysis book can
  // offer "open the thread this came from" — reading a conclusion without
  // being able to get back to the reasoning that produced it is most of
  // what makes a saved item feel inert. Optional: analyses saved before
  // this existed simply don't offer the jump.
  sessionId?: string;
  serverChatId?: number;
}

// What actually grounded an answer. /ai/analyze has always returned these
// (lib/confidence.ts), but they were absent from the OpenAPI contract, so the
// generated client dropped them and Venus.tsx never saw them — the chat
// showed a single "Verified precedent" pill and discarded the list of
// precedents behind it along with any recorded disagreement between them.
// Persisted alongside the message so reopening a saved analysis still shows
// what it was based on.
export interface EvidenceRefEntry {
  type: 'precedent' | 'own_decision';
  id: number;
  label: string;
  weight?: number;
}

export interface ContradictionEntry {
  description: string;
  precedentIds?: number[];
}

// Response-integrity signals. The server computes both on every answer
// (arithmeticCheck.ts ships live; lengthConstraintNote is written when a
// stated word/character target couldn't be met) and both were being
// returned and then silently discarded here — computed honesty that never
// reached the person it was for. Persisted with the message so a reopened
// analysis still carries its caveats.
export interface ArithmeticIssueEntry {
  description: string;
  mentionA?: string;
  mentionB?: string;
}

// Promoted off shadow-mode (see lib/groundedness.ts on the server) — was
// logged only and never reached the founder. Same non-blocking caveat
// posture as ArithmeticIssueEntry above: never silently discarded (a real
// fabrication with no warning erodes trust worse than a rare false
// positive costs), never blocks the response either.
export interface GroundednessIssueEntry {
  description: string;
}

export interface ChatMessage {
  role: 'user' | 'venus';
  content?: string;
  cards?: any[];
  confidence?: 'verified' | 'exploratory';
  confidenceNote?: string;
  // What actually earned "verified", when confidence is 'verified' — the
  // curated precedent dataset, or this founder's own resolved-decision
  // track record (see lib/confidence.ts on the server). Lets the badge say
  // which one honestly instead of always crediting the dataset.
  groundedIn?: 'precedent' | 'own_history' | null;
  contextQuery?: string;
  evidenceRefs?: EvidenceRefEntry[];
  contradictions?: ContradictionEntry[];
  arithmeticIssues?: ArithmeticIssueEntry[];
  groundednessIssues?: GroundednessIssueEntry[];
  lengthConstraintNote?: string;
  // Set on a user message sent with a file attached. `content` still carries
  // the "[Attached file: x]" marker (see Venus.tsx's handleSend and
  // attachmentContext.ts on the server) because that text is what tells the
  // model a file exists — this is purely for the UI to render the file as a
  // proper chip instead of that marker text, and to know what to fetch when
  // the founder clicks it to preview.
  attachment?: { id: number; fileName: string; mimeType: string };
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  messages: ChatMessage[];
  // Maps this local session to a real server-side `chats` row (see
  // artifacts/api-server/src/routes/chats.ts). Undefined until the first
  // message is sent in this session — created lazily rather than on every
  // "New Analysis" click, so a session someone opens and abandons without
  // ever sending a message doesn't leave an orphan row server-side. Once
  // set, this is what a Goal actually attaches to: goals are keyed on
  // chatId, not on the local session id, so Goal state survives even if
  // localStorage is cleared as long as the founder is signed in.
  serverChatId?: number;
}

const SESSIONS_KEY = 've_chat_sessions';
const SAVED_KEY = 've_saved_analyses';

/**
 * One-shot handoff for "open this specific chat", written by a route that
 * isn't Venus (currently DecisionsOverview) and read by Venus on mount.
 *
 * A key rather than a URL parameter because chat identity is local: sessions
 * live in localStorage and only some of them have a server chat id, so a
 * shareable /vera?chat=<id> link would be dead for anyone but this browser.
 * Deliberately consumed on read — see takePendingChatId — so a later reload
 * doesn't yank the founder back to a decision they already looked at.
 */
export const OPEN_CHAT_KEY = 've_open_chat';

/** Reads and clears the pending chat id. Returns null when none is set. */
export function takePendingChatId(): number | null {
  try {
    const raw = localStorage.getItem(OPEN_CHAT_KEY);
    if (!raw) return null;
    localStorage.removeItem(OPEN_CHAT_KEY);
    const id = Number(raw);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
   The answer to "What brings you here today?", on its way to becoming the
   first real conversation.

   Set by the onboarding funnel and consumed by Venus on mount, which then sends
   it as the founder's own first message. Same shape and same reasoning as
   OPEN_CHAT_KEY above: local, because the chat it will become does not exist
   yet and has no server id to point at.

   WHY THIS EXISTS AT ALL. Onboarding asked what brought them here and then —
   before this — dropped them on an empty chat screen with six generic example
   prompts. The question had been asked purely for our benefit. A founder who
   says "my churn is climbing and I don't know why" and is handed a blank box
   has been surveyed; one who arrives to find Vera already working on their
   churn has been answered, and has watched the product do the thing it claims
   to do before being asked to trust it with anything.

   CONSUMED ON READ, like the chat key, so a reload later never re-sends a
   question the founder has already had answered — which would look like the
   product forgetting, in the exact place it is trying to prove it remembers.
--------------------------------------------------------------------------- */
export const SEED_MESSAGE_KEY = 've_seed_message';

/** Longer than any preset, short enough that pasting an entire document cannot
 *  become an unbounded first prompt. */
const MAX_SEED_LENGTH = 500;

export function setPendingSeedMessage(text: string): void {
  try {
    const trimmed = text.trim().slice(0, MAX_SEED_LENGTH);
    if (trimmed) localStorage.setItem(SEED_MESSAGE_KEY, trimmed);
  } catch {}
}

/** Reads and clears the pending seed message. Null when none is set. */
export function takePendingSeedMessage(): string | null {
  try {
    const raw = localStorage.getItem(SEED_MESSAGE_KEY);
    if (!raw) return null;
    localStorage.removeItem(SEED_MESSAGE_KEY);
    const trimmed = raw.trim();
    return trimmed ? trimmed.slice(0, MAX_SEED_LENGTH) : null;
  } catch {
    return null;
  }
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Rebuilds a local session for a chat this browser has no record of, from the
 * server's permanent message log (GET /api/chats/:id/messages).
 *
 * Sessions live in localStorage and are capped at 50, so a decision logged
 * three months ago, or one made on a different device, or any chat at all
 * after clearing history, has a server chat id with nothing local behind it.
 * "Open chat" used to silently fall back to the most recent session in that
 * case — it opened a real conversation, just not the one named on the card,
 * which is worse than opening nothing because there is no sign it happened.
 *
 * Returns null when the chat genuinely can't be fetched; callers should say so
 * rather than substituting a different chat. The rebuilt session is persisted,
 * so the same jump is instant next time.
 */
export async function hydrateSessionFromServer(serverChatId: number): Promise<ChatSession | null> {
  try {
    const response = await fetch(`/api/chats/${serverChatId}/messages`);
    if (!response.ok) return null;
    const body = (await response.json()) as {
      chat?: { id: number; title?: string | null; createdAt?: string | null };
      messages?: { role: string; content: string }[];
    };

    const session: ChatSession = {
      id: uid(),
      title: body.chat?.title || 'Chat',
      createdAt: body.chat?.createdAt ?? new Date().toISOString(),
      // The log stores the words, not the cards that were rendered beside
      // them — an honest transcript, which is what the founder came back for.
      messages: (body.messages ?? []).map((m) => ({
        role: m.role === 'user' ? 'user' : 'venus',
        content: m.content,
      })),
      serverChatId,
    };
    saveSession(session);
    return session;
  } catch {
    return null;
  }
}

export function getSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveSession(session: ChatSession) {
  try {
    const sessions = getSessions().filter(s => s.id !== session.id);
    sessions.unshift(session);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 50)));
  } catch {}
}

export function deleteSession(id: string) {
  try {
    const sessions = getSessions().filter(s => s.id !== id);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {}
}

export function createSession(): ChatSession {
  return { id: uid(), title: 'New Chat', createdAt: new Date().toISOString(), messages: [] };
}

export function titleFromMessage(msg: string): string {
  return msg.length > 45 ? msg.slice(0, 42) + '…' : msg;
}

export function getSavedAnalyses(): SavedAnalysis[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveAnalysis(analysis: Omit<SavedAnalysis, 'id' | 'savedAt'>): SavedAnalysis {
  const entry: SavedAnalysis = { ...analysis, id: uid(), savedAt: new Date().toISOString() };
  try {
    const saved = getSavedAnalyses();
    saved.unshift(entry);
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved.slice(0, 100)));
  } catch {}
  return entry;
}

export function deleteSavedAnalysis(id: string) {
  try {
    const saved = getSavedAnalyses().filter(s => s.id !== id);
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  } catch {}
}

// Card types are a real structural signal and are trusted first. The prose
// keywords below are only a last resort, and are deliberately much narrower
// than they used to be: the old list matched any occurrence of "milestone" or
// "quarter" anywhere in the summary, so a diagnosis of a retention problem
// that happened to mention "hit the first-value milestone within 30 days" was
// offered to the founder as "Save as Roadmap". Mislabelling what a saved
// analysis IS makes the saved library harder to search the more it fills up,
// which is exactly backwards.
//
// Now the prose fallback requires the phrase to be about the artefact itself,
// not merely to contain a word associated with it.
export function detectAnalysisType(content: string, cards?: any[]): SavedAnalysisType {
  if (cards?.some(c => c.type === 'risk')) return 'risk';
  if (cards?.some(c => c.type === 'roadmap')) return 'roadmap';
  if (cards?.some(c => c.type === 'precedent')) return 'pattern';
  if (cards?.some(c => c.type === 'market')) return 'competitive';
  const lower = content?.toLowerCase() ?? '';
  if (/\broadmap\b/.test(lower)) return 'roadmap';
  if (/\b(fundrais\w*|term sheet|cap table|investor fit)\b/.test(lower)) return 'fundraising';
  if (/\b(competitive landscape|competitor\w*|market share)\b/.test(lower)) return 'competitive';
  if (/\b(risk register|biggest risk|key risks)\b/.test(lower)) return 'risk';
  if (/\b(precedent\w*|post-?mortem)\b/.test(lower)) return 'pattern';
  return 'analysis';
}

const TYPE_LABELS: Record<SavedAnalysisType, string> = {
  risk: 'Risk Analysis',
  roadmap: 'Roadmap',
  pattern: 'Pattern Match',
  fundraising: 'Fundraising Intel',
  competitive: 'Competitive Radar',
  analysis: 'Analysis',
};

export function typeLabel(t: SavedAnalysisType) { return TYPE_LABELS[t]; }
