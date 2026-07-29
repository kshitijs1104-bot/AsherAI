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

export interface ChatMessage {
  role: 'user' | 'venus';
  content?: string;
  cards?: any[];
  confidence?: 'verified' | 'exploratory';
  confidenceNote?: string;
  contextQuery?: string;
  evidenceRefs?: EvidenceRefEntry[];
  contradictions?: ContradictionEntry[];
  arithmeticIssues?: ArithmeticIssueEntry[];
  lengthConstraintNote?: string;
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

function uid() {
  return Math.random().toString(36).slice(2, 10);
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
