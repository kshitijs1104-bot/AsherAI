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

export interface ChatMessage {
  role: 'user' | 'venus';
  content?: string;
  cards?: any[];
  confidence?: 'verified' | 'exploratory';
  confidenceNote?: string;
  contextQuery?: string;
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

export function detectAnalysisType(content: string, cards?: any[]): SavedAnalysisType {
  if (cards?.some(c => c.type === 'risk')) return 'risk';
  if (cards?.some(c => c.type === 'roadmap')) return 'roadmap';
  if (cards?.some(c => c.type === 'market')) return 'fundraising';
  const lower = content?.toLowerCase() ?? '';
  if (lower.includes('risk') || lower.includes('threat') || lower.includes('mitigation')) return 'risk';
  if (lower.includes('roadmap') || lower.includes('quarter') || lower.includes('milestone')) return 'roadmap';
  if (lower.includes('fundrais') || lower.includes('investor') || lower.includes('term sheet')) return 'fundraising';
  if (lower.includes('competitor') || lower.includes('competitive') || lower.includes('market share')) return 'competitive';
  if (lower.includes('failure') || lower.includes('precedent') || lower.includes('pattern')) return 'pattern';
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
