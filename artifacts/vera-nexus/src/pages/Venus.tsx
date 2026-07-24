import { useVenusAnalyze, useCreateChat, useUpdateChat } from '@workspace/api-client-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import {
  getSessions, saveSession, deleteSession, createSession,
  getSavedAnalyses, saveAnalysis, deleteSavedAnalysis,
  detectAnalysisType, typeLabel, titleFromMessage,
  type ChatSession, type ChatMessage, type SavedAnalysisType, type SavedAnalysis,
} from '../lib/venusHistory';
import { Settings, Plus, Trash2, ChevronDown, ChevronRight, Copy, Download, Check, Target, ListChecks, Map as MapIcon, PanelLeftClose, PanelLeftOpen, Pencil, LayoutGrid, Workflow as WorkflowIcon, Paperclip, X, Loader2, AlertCircle } from 'lucide-react';
import { GoalPanel } from './GoalPanel';
import { RoadmapTracker } from './RoadmapTracker';
import { TodayCard } from './TodayCard';
import { VenusThemeToggle } from './VenusThemeToggle';
import { NotificationBell } from './NotificationBell';
import { CommandCenterSection } from './CommandCenter';
import { AttachMenu } from './AttachMenu';
import { ConnectorPicker } from './ConnectorPicker';
import { useVenusTheme } from '../lib/venusTheme';
import { useUploadAttachment, useQueue, type UploadedAttachment } from '../lib/venusApi';

// One consistent compact row shape for everything below New Chat — replaces
// the old mismatched treatment (a separately-styled full-width Command
// Center button sitting above a visually unrelated two-column Goal/Roadmap
// toggle row). "Nav" rows just navigate; "toggle" rows show a persistent
// tinted/active state while their panel is open, so the two behaviors read
// as one family instead of unrelated components bolted together.
function SidebarNavRow({ icon: Icon, label, onClick, badgeCount }: { icon: typeof LayoutGrid; label: string; onClick: () => void; badgeCount?: number }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-[9px] text-[13px] font-medium rounded-[10px] transition-colors"
      style={{ color: 'var(--v7-text-dim)', padding: '8px 8px' }}
      onMouseEnter={e => { e.currentTarget.style.color = 'var(--v7-text)'; e.currentTarget.style.background = 'var(--v7-bg-raised-2)'; }}
      onMouseLeave={e => { e.currentTarget.style.color = 'var(--v7-text-dim)'; e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      {/* Replaces the separate notification bell — Command Center is
          already the destination for pending items, so the unread count
          lives directly on its own nav row instead of a second icon. */}
      {!!badgeCount && badgeCount > 0 && (
        <span
          className="ml-auto flex items-center justify-center rounded-full text-[9px] font-bold"
          style={{ minWidth: '15px', height: '15px', padding: '0 4px', background: 'var(--red, #e5555c)', color: '#fff', lineHeight: 1 }}
        >
          {badgeCount > 9 ? '9+' : badgeCount}
        </span>
      )}
    </button>
  );
}

function SidebarToggleRow({ icon: Icon, label, active, onClick }: { icon: typeof Target; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-[9px] text-[13px] font-medium rounded-[10px] transition-colors"
      style={{
        color: active ? 'var(--v7-cyan)' : 'var(--v7-text-dim)',
        background: active ? 'var(--v7-cyan-soft)' : 'transparent',
        padding: '8px 8px',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--v7-bg-raised-2)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      title={active ? `Hide ${label.toLowerCase()} panel` : `Show ${label.toLowerCase()} panel`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      {active && <span className="w-1.5 h-1.5 rounded-full ml-auto" style={{ background: 'var(--v7-cyan)' }} />}
    </button>
  );
}

const EXAMPLE_PROMPTS = [
  "Map the causal chain for my business from the most significant market shifts right now",
  "What's my biggest risk right now and how do I fix it?",
  "Build me a 6-month roadmap based on similar companies at my stage",
  "Find 3 failed companies most similar to mine and why they failed",
  "Run an investor-fit analysis — which VCs are most likely to fund us?",
];

const SAVED_TYPE_COLORS: Record<SavedAnalysisType, string> = {
  risk: 'var(--red)',
  roadmap: 'var(--mint)',
  pattern: 'var(--amber)',
  fundraising: 'var(--indigo-light)',
  competitive: 'var(--green)',
  analysis: 'var(--dim)',
};

interface CompanyReportSnapshot {
  foundedYear?: string;
  founders?: string[];
  fundingRaised?: string;
  whatTheyBuilt?: string;
}

interface CompanyReport {
  companyName: string;
  snapshot: CompanyReportSnapshot;
  timeline: Array<{ label: string; detail: string }>;
  analysis: string;
  sources: Array<{ title: string; url: string }>;
  generatedAt: string;
}

interface CompanyReportState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  report?: CompanyReport;
  error?: string;
}

function normalizeCompanyKey(companyName: string) {
  return companyName.trim().toLowerCase().replace(/\s+/g, ' ');
}

function loadCompanyReportCache(): Record<string, CompanyReportState> {
  try {
    const raw = localStorage.getItem('ve_company_reports');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistCompanyReportCache(cache: Record<string, CompanyReportState>) {
  try {
    localStorage.setItem('ve_company_reports', JSON.stringify(cache));
  } catch {}
}

// Whether the Goal/Roadmap panels show above the chat thread at all — a
// global per-founder preference, not per-chat. GoalPanel already has its
// own open/closed state for its DETAIL view, and RoadmapTracker its own for
// its phase list, but neither could previously be hidden entirely: the
// summary bar always took header space, on every chat, every visit, even
// collapsed. This is the layer above that — "do I want to see this at all
// right now" — controlled from the sidebar (see the toggle row below) so
// hiding one never affects the other, and the choice sticks instead of
// resetting on the next visit.
const SHOW_GOAL_PANEL_KEY = 've_show_goal_panel';
const SHOW_ROADMAP_KEY = 've_show_roadmap';
const SIDEBAR_COLLAPSED_KEY = 've_sidebar_collapsed';

// Tracks whether the viewport is below Tailwind's `md` breakpoint. Used to
// force the sidebar into its rail on phones without touching the founder's
// stored desktop preference (see railMode in VenusPage).
const NARROW_QUERY = '(max-width: 767px)';

function useIsNarrowViewport(): boolean {
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    setIsNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isNarrow;
}

function loadPanelPref(key: string, defaultValue = true): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? defaultValue : raw === 'true';
  } catch {
    return defaultValue;
  }
}

function savePanelPref(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Best-effort — a private-browsing tab with no localStorage just means
    // the preference resets next visit, which is harmless.
  }
}

function groupSavedByType(saved: ReturnType<typeof getSavedAnalyses>) {
  const groups: Partial<Record<SavedAnalysisType, typeof saved>> = {};
  for (const s of saved) {
    if (!groups[s.type]) groups[s.type] = [];
    groups[s.type]!.push(s);
  }
  return groups;
}

// Shows the file selected via the composer's paperclip button, before it's
// actually sent — an uploading spinner while the request is in flight, the
// filename plus a remove button once it lands. Uploads happen immediately
// on selection (see handleFileSelect), not at send time, so a bad file
// (wrong type, too large) fails right away instead of only surfacing once
// the whole message send fails.
function AttachmentChip({ fileName, previewUrl, uploading, error, onRemove }: { fileName?: string; previewUrl?: string | null; uploading: boolean; error?: string; onRemove: () => void }) {
  if (error) {
    return (
      <div
        className="inline-flex items-center gap-2 text-[12px] font-medium px-2.5 py-1.5 rounded-lg mb-2"
        style={{ background: 'var(--v7-bg-raised-2, var(--surface2))', color: 'var(--red, #e5555c)' }}
      >
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate max-w-[260px]">{error}</span>
        <button onClick={onRemove} title="Dismiss">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // An image shows itself. The thumbnail is the confirmation that the right
  // file was picked — a filename is not, especially for camera rolls and
  // screenshots where every name looks the same.
  if (previewUrl) {
    return (
      <div
        className="inline-flex items-center gap-2.5 text-[12px] font-medium p-1.5 pr-2.5 rounded-xl mb-2"
        style={{ background: 'var(--v7-bg-raised-2, var(--surface2))', color: 'var(--v7-text-dim, var(--dim))' }}
      >
        <div className="relative shrink-0">
          <img
            src={previewUrl}
            alt={fileName ? `Preview of ${fileName}` : 'Attached image preview'}
            className="w-11 h-11 rounded-lg object-cover"
            style={{ border: '1px solid var(--v7-border, var(--border))' }}
          />
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg" style={{ background: 'rgba(0,0,0,0.45)' }}>
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#fff' }} />
            </div>
          )}
        </div>
        <span className="truncate max-w-[180px]">{uploading ? 'Uploading…' : fileName}</span>
        {!uploading && (
          <button onClick={onRemove} title="Remove attachment" className="shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-2 text-[12px] font-medium px-2.5 py-1.5 rounded-lg mb-2"
      style={{ background: 'var(--v7-bg-raised-2, var(--surface2))', color: 'var(--v7-text-dim, var(--dim))' }}
    >
      {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
      <span className="truncate max-w-[220px]">{uploading ? 'Uploading…' : fileName}</span>
      {!uploading && (
        <button onClick={onRemove} title="Remove attachment">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export function VenusPage() {
  const [, navigate] = useLocation();
  const { theme, toggle: toggleTheme } = useVenusTheme();
  const [sessions, setSessions] = useState<ChatSession[]>(getSessions);
  const [currentSession, setCurrentSession] = useState<ChatSession>(() => {
    const existing = getSessions();
    return existing.length > 0 ? existing[0] : createSession();
  });
  const [saved, setSaved] = useState(getSavedAnalyses);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [showGoalPanel, setShowGoalPanel] = useState(() => loadPanelPref(SHOW_GOAL_PANEL_KEY));
  const [showRoadmap, setShowRoadmap] = useState(() => loadPanelPref(SHOW_ROADMAP_KEY));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => loadPanelPref(SIDEBAR_COLLAPSED_KEY, false));
  // Venus was authored desktop-only (no responsive breakpoint anywhere in
  // this file), so the 260px sidebar kept its full width on a phone: at
  // 390px it left ~130px for the chat column and squeezed the composer
  // textarea down to ~32px wide — the primary input of the whole product,
  // unusable. Below `md` the sidebar is forced to its existing 44px rail
  // (which already carries the expand toggle, theme switch and bell), so
  // the chat keeps the screen. This deliberately does NOT write to
  // SIDEBAR_COLLAPSED_KEY — a phone visit must not silently collapse the
  // sidebar for the founder's next desktop session.
  const isNarrow = useIsNarrowViewport();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // On a phone the sidebar starts as the rail and, when opened, floats over
  // the chat as a drawer instead of pushing it sideways — pushing is what
  // squeezed the composer to nothing. On desktop nothing changes: the
  // persisted collapse preference still drives it.
  const railMode = isNarrow ? !mobileNavOpen : sidebarCollapsed;
  const asideFloats = isNarrow && mobileNavOpen;
  // Command Center opens INTO this same view — same swap New Chat does —
  // never a separate route. 'chat' is the default/only state a fresh
  // session or session-switch returns to. The one exception: a fresh page
  // load (not a client-side nav) can request it via ?view=command-center —
  // the only way an OAuth callback redirect (see routes/connectors.ts's
  // frontendReturnUrl) can land a founder back INTO this client-state view
  // instead of just the plain chat.
  const [mainView, setMainView] = useState<'chat' | 'command-center'>(() =>
    new URLSearchParams(window.location.search).get('view') === 'command-center' ? 'command-center' : 'chat',
  );
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [groqKey, setGroqKey] = useState(() => localStorage.getItem('ve_groq_key') || '');
  const [input, setInput] = useState('');
  const [companyReports, setCompanyReports] = useState<Record<string, CompanyReportState>>(loadCompanyReportCache);
  const [pendingAttachment, setPendingAttachment] = useState<UploadedAttachment | null>(null);
  // Local object URL for an image attachment, so the composer shows the
  // picture itself rather than its filename. Null for non-image files.
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadAttachment = useUploadAttachment();
  // Backs the Command Center nav row's unread badge — same query
  // NotificationBell used to poll independently, now read once here.
  const { data: queueData } = useQueue();
  const pendingQueueCount = queueData?.items.filter(i => i.status === 'pending').length ?? 0;
  const endRef = useRef<HTMLDivElement | null>(null);
  const analyzeMutation = useVenusAnalyze();
  const createChatMutation = useCreateChat();
  const updateChatMutation = useUpdateChat();

  // Uploads immediately on file selection (same interaction shape as
  // Slack/ChatGPT) rather than waiting for send — the founder gets to see
  // and remove it before committing, and a failed upload is caught right
  // away instead of surfacing only when the whole message fails to send.
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    // Preview comes from the local File, not the uploaded URL: it can be
    // shown the instant the picker closes (while the upload is still in
    // flight) and it costs no extra network round trip. Attaching a
    // screenshot and being shown only "Screenshot 2026-07-25.png" gives the
    // founder no way to confirm they picked the right image.
    setAttachmentPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    });

    uploadAttachment.mutate(
      { file, chatId: currentSession.serverChatId },
      { onSuccess: (attachment) => setPendingAttachment(attachment) },
    );
  };

  // Object URLs are held by the browser until explicitly revoked, so every
  // path that drops the attachment goes through here.
  const clearAttachment = () => {
    setAttachmentPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setPendingAttachment(null);
  };

  const messages = currentSession.messages;

  // Always the latest committed ChatSession, kept in sync on every render
  // (a plain assignment during render, not an effect — effects lag a tick
  // behind, which is exactly the gap that caused the original bug). Async
  // handlers below read this instead of closing over `currentSession`
  // directly, so a network round-trip in between never sees stale state —
  // without relying on setCurrentSession's functional-updater callback
  // running synchronously, which React documents as an implementation
  // detail, not a guarantee (it can be skipped, e.g. when another state
  // update — like the founder typing into the input — is already pending
  // on this component when the round-trip resolves).
  const sessionRef = useRef(currentSession);
  sessionRef.current = currentSession;

  const persistSession = useCallback((session: ChatSession) => {
    saveSession(session);
    setSessions(getSessions());
  }, []);

  // Lazily creates the real server-side `chats` row the first time it's
  // actually needed (first message sent, or the Goal panel is opened before
  // any message exists) rather than on every "New Analysis" click — a
  // session someone opens and abandons without sending anything or setting
  // a goal never leaves an orphan row. Persists the returned id onto the
  // local ChatSession immediately so a second call in the same session
  // reuses it instead of creating a duplicate chat.
  //
  // Merges onto `sessionRef.current` (see above), not the `currentSession`
  // this closure captured when it was called — this function awaits a real
  // network round-trip, and during that gap `handleSend` has already
  // optimistically added the user's message to state; merging against a
  // stale closure instead of the latest state was overwriting that
  // optimistic message back to an empty array, which is what made the chat
  // revert to the new-chat landing page mid-send (see handleSend's
  // onSuccess for the matching fix).
  const ensureServerChat = useCallback(async (titleOverride?: string): Promise<number> => {
    if (currentSession.serverChatId) return currentSession.serverChatId;
    const created = await createChatMutation.mutateAsync({ data: { title: titleOverride ?? currentSession.title } });
    const withServerId: ChatSession = { ...sessionRef.current, serverChatId: created.id };
    setCurrentSession(withServerId);
    persistSession(withServerId);
    return created.id;
  }, [currentSession.serverChatId, currentSession.title, createChatMutation, persistSession]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, analyzeMutation.isPending]);

  const handleNewChat = () => {
    const s = createSession();
    setCurrentSession(s);
    setMainView('chat');
  };

  const toggleGoalPanel = () => setShowGoalPanel((v) => { const next = !v; savePanelPref(SHOW_GOAL_PANEL_KEY, next); return next; });
  const toggleRoadmap = () => setShowRoadmap((v) => { const next = !v; savePanelPref(SHOW_ROADMAP_KEY, next); return next; });
  // On a phone this drives the transient drawer and must not write the
  // desktop preference — otherwise opening the nav once on mobile would
  // leave the founder's next desktop session collapsed.
  const toggleSidebar = () => {
    if (isNarrow) { setMobileNavOpen((v) => !v); return; }
    setSidebarCollapsed((v) => { const next = !v; savePanelPref(SIDEBAR_COLLAPSED_KEY, next); return next; });
  };

  const startRename = (s: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingSessionId(s.id);
    setRenameDraft(s.title);
  };
  const commitRename = (s: ChatSession) => {
    const title = renameDraft.trim();
    setRenamingSessionId(null);
    if (!title || title === s.title) return;
    const updated: ChatSession = { ...s, title };
    if (currentSession.id === s.id) setCurrentSession(updated);
    persistSession(updated);
    if (s.serverChatId) updateChatMutation.mutate({ id: s.serverChatId, data: { title } });
  };

  const handleSelectSession = (s: ChatSession) => {
    setCurrentSession(s);
    setInput('');
    setMainView('chat');
  };

  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteSession(id);
    setSessions(getSessions());
    if (currentSession.id === id) setCurrentSession(createSession());
  };

  const handleSend = async (preset?: string) => {
    const baseText = (preset || input).trim();
    if (!baseText && !pendingAttachment) return;
    // The Enter-key path (unlike the Send button's `disabled` prop) had no
    // guard against firing while a request is already in flight — two fast
    // Enter presses on the first message of a new chat could each read the
    // same not-yet-set `serverChatId` and independently call
    // ensureServerChat, creating two server-side chat rows for one session.
    if (analyzeMutation.isPending) return;
    // The attachment already uploaded (and is tied to a chatId) the moment
    // it was selected — folding its filename into the message text is the
    // simplest honest way to give Venus's existing text-only pipeline any
    // awareness of it at all, short of a deeper multimodal-input rework.
    const text = pendingAttachment ? `${baseText}\n\n[Attached file: ${pendingAttachment.fileName}]`.trim() : baseText;
    setInput('');
    clearAttachment();

    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    const updatedTitle = messages.length === 0 ? titleFromMessage(text) : currentSession.title;
    const updated: ChatSession = { ...currentSession, messages: newMessages, title: updatedTitle };
    setCurrentSession(updated);
    persistSession(updated);

    // Every message needs a real chatId so the backend can (a) inject this
    // chat's goal into the system prompt and (b) attribute any decision/
    // roadmap card this turn produces back to this chat — otherwise a Goal
    // set later would have no evidence to grow from. Failing to create the
    // server chat should never block sending the message itself; Venus
    // still answers, it just can't attribute this particular turn.
    let chatId: number | undefined;
    try {
      chatId = await ensureServerChat(updatedTitle);
    } catch {
      chatId = currentSession.serverChatId;
    }

    analyzeMutation.mutate(
      { data: { message: text, chatId, sessionHistory: messages.map(m => ({ role: m.role, content: m.content ?? '' })) } },
      {
        onSuccess: (res) => {
          const venusMsg: ChatMessage = {
            role: 'venus',
            content: res.summary,
            cards: res.cards,
            confidence: res.confidence,
            confidenceNote: res.confidenceNote,
            contextQuery: text,
          };
          // Merge onto sessionRef.current (see its declaration above), not
          // `updated` — that's a snapshot from before ensureServerChat's
          // await, so building the final state from it would silently drop
          // the serverChatId ensureServerChat may have set in the meantime.
          // Plain object construction, not a setState updater — persisting
          // (a real localStorage write) as a side effect inside an updater
          // callback is unsafe: React documents updaters as pure functions
          // that may run more than once for one commit (Strict Mode
          // double-invocation, a preempted/discarded render), which would
          // have made persistSession fire an extra, wasted time.
          const withVenus: ChatSession = { ...sessionRef.current, messages: [...sessionRef.current.messages, venusMsg] };
          setCurrentSession(withVenus);
          persistSession(withVenus);
        },
      }
    );
  };

  const handleSaveResponse = (msg: ChatMessage) => {
    const type = detectAnalysisType(msg.content ?? '', msg.cards);
    const title = typeLabel(type) + ' — ' + new Date().toLocaleDateString();
    saveAnalysis({
      type,
      title,
      summary: msg.content ?? '',
      cards: msg.cards,
      confidence: msg.confidence,
      confidenceNote: msg.confidenceNote,
      contextQuery: msg.contextQuery,
      // Recorded so the Saved Analysis book can jump back to the thread
      // this conclusion came out of.
      sessionId: currentSession.id,
      serverChatId: currentSession.serverChatId,
    });
    setSaved(getSavedAnalyses());
  };

  const handleOpenSaved = (item: ReturnType<typeof getSavedAnalyses>[number]) => {
    // Reopen a saved analysis as a fresh read-only session in the main chat view.
    // Previously saved items had no click handler at all — this is the missing
    // read-back path for the write-only save action.
    const reopened: ChatSession = {
      ...createSession(),
      title: item.title,
      messages: [
        {
          role: 'venus',
          content: item.summary,
          cards: item.cards ?? [],
          confidence: item.confidence,
          confidenceNote: item.confidenceNote,
          contextQuery: item.contextQuery,
        },
      ],
    };
    setCurrentSession(reopened);
    persistSession(reopened);
  };

  // "Open original chat" from the Saved Analysis book. Opens the REAL thread
  // the analysis came out of, so the founder gets the whole conversation
  // that produced it — unlike handleOpenSaved above, which reconstructs a
  // one-message read-only view from the saved copy. Falls back to that when
  // the source session is gone (cleared localStorage, or an analysis saved
  // before sessionId was recorded), which is why this is best-effort rather
  // than an error path.
  const handleOpenSavedThread = (item: SavedAnalysis) => {
    const source = item.sessionId ? getSessions().find((s) => s.id === item.sessionId) : undefined;
    if (source) {
      setCurrentSession(source);
      setMainView('chat');
      return;
    }
    handleOpenSaved(item);
    setMainView('chat');
  };

  // Mini Vera hands its exchange over here once it hits its turn limit: the
  // messages become a real session with real history, rather than being
  // thrown away when the panel closes.
  const handleContinueFromMiniVera = (miniMessages: ChatMessage[]) => {
    const firstUser = miniMessages.find((m) => m.role === 'user');
    const continued: ChatSession = {
      ...createSession(),
      title: firstUser?.content ? titleFromMessage(firstUser.content) : 'Continued from saved analysis',
      messages: miniMessages,
    };
    setCurrentSession(continued);
    persistSession(continued);
    setMainView('chat');
  };

  const handleGenerateCompanyReport = useCallback(async (companyName: string) => {
    const key = normalizeCompanyKey(companyName);
    if (!key) return;

    setCompanyReports(prev => ({
      ...prev,
      [key]: { status: 'loading', report: prev[key]?.report, error: undefined },
    }));

    try {
      const response = await fetch('/api/ai/company-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, context: messages[messages.length - 1]?.content ?? '' }),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const report = await response.json();
      const nextState = {
        status: 'ready' as const,
        report,
      };
      setCompanyReports(prev => {
        const updated = { ...prev, [key]: nextState };
        persistCompanyReportCache(updated);
        return updated;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setCompanyReports(prev => {
        const updated = { ...prev, [key]: { status: 'error' as const, error: message } };
        persistCompanyReportCache(updated);
        return updated;
      });
    }
  }, [messages]);

  const handleDeleteSaved = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteSavedAnalysis(id);
    setSaved(getSavedAnalyses());
  };

  const toggleGroup = (type: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const savedGroups = groupSavedByType(saved);

  return (
    <div
      className={`flex h-screen w-full overflow-hidden ${theme === 'light' ? 'v7-light' : ''}`}
      style={{
        background: 'var(--v7-bg)',
        color: 'var(--v7-text)',
        fontFamily: 'var(--v7-font-round)',
      }}
    >
      {/* Left Sidebar — collapsible to a thin rail so the chat can go full
          width. Collapsed state persists (ve_sidebar_collapsed) so it
          doesn't reset back open on the next visit. */}
      {railMode ? (
        <div
          className="w-[44px] flex flex-col items-center gap-1 shrink-0 sticky top-0 h-screen"
          style={{ background: 'var(--v7-bg-raised)', borderRight: '1px solid var(--v7-border)', paddingTop: '20px' }}
        >
          <button
            onClick={toggleSidebar}
            title="Expand sidebar"
            className="p-1.5 rounded-lg"
            style={{ color: 'var(--v7-text-mute)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--v7-text-dim)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--v7-text-mute)')}
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
          <VenusThemeToggle theme={theme} onToggle={toggleTheme} />
          <NotificationBell onOpenCommandCenter={() => setMainView('command-center')} />
        </div>
      ) : (
      <>
      {asideFloats && (
        <div
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.5)' }}
        />
      )}
      <aside
        className={`w-[260px] flex flex-col shrink-0 h-screen ${asideFloats ? 'fixed inset-y-0 left-0 z-50' : 'sticky top-0'}`}
        style={{
          background: 'var(--v7-bg-raised)',
          borderRight: '1px solid var(--v7-border)',
          padding: '20px 14px',
          ...(asideFloats ? { boxShadow: '0 0 40px rgba(0,0,0,0.45)' } : {}),
        }}
      >
        {/* Brand mark — moved here from the chat header so it doesn't eat
            vertical space above the goal panel. Sits once, above the back
            link, instead of repeating on every chat. */}
        <div className="flex items-center justify-between" style={{ padding: '2px 8px 14px' }}>
          <div className="flex items-center gap-[8px]">
            <div
              className="w-6 h-6 flex items-center justify-center shrink-0"
              style={{ borderRadius: '9px', background: 'var(--v7-bg-raised-2)', border: '1px solid var(--v7-border-strong)' }}
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-[14px] h-[14px]">
                <circle cx="12" cy="12" r="9.5" stroke="#3a3d47" strokeWidth="0.8"/>
                <g transform="rotate(-16 12 12)">
                  <path d="M12 4.5L13.6 12H10.4L12 4.5Z" fill="#00e5b0"/>
                  <path d="M12 19.5L11.1 12H12.9L12 19.5Z" fill="#5b4fe8"/>
                </g>
                <circle cx="12" cy="12" r="1.1" fill="var(--v7-bg-raised-2)" stroke="#3a3d47" strokeWidth="0.5"/>
              </svg>
            </div>
            <span className="font-extrabold text-[15px]" style={{ letterSpacing: '-0.01em' }}>Vera</span>
          </div>
          <div
            className="flex items-center gap-[5px] font-medium text-[9px] uppercase"
            style={{
              fontFamily: 'var(--v7-font-mono)',
              letterSpacing: '0.05em',
              color: 'var(--v7-text-dim)',
              border: '1px solid var(--v7-border-strong)',
              borderRadius: '100px',
              padding: '3px 8px 3px 7px',
            }}
          >
            <span className="w-[4px] h-[4px] rounded-full" style={{ background: 'var(--v7-cyan)', boxShadow: '0 0 6px var(--v7-cyan)' }}></span>
            Enterprise
          </div>
        </div>

        {/* Back link + sidebar collapse */}
        <div className="flex items-center justify-between" style={{ padding: '0 0 22px' }}>
          <button
            onClick={() => navigate('/line')}
            className="flex items-center gap-[7px] text-[13px] font-medium transition-colors"
            style={{ color: 'var(--v7-text-mute)', padding: '8px 8px' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--v7-text-dim)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--v7-text-mute)')}
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5"><path d="M15 5L8 12L15 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Back to Vera Nexus
          </button>
          <div className="flex items-center gap-1 shrink-0">
            <VenusThemeToggle theme={theme} onToggle={toggleTheme} />
            <button
              onClick={toggleSidebar}
              title="Collapse sidebar"
              className="p-1.5 rounded-lg shrink-0"
              style={{ color: 'var(--v7-text-mute)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--v7-text-dim)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--v7-text-mute)')}
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* New Chat — the one hero CTA, first. Everything else below is a
            single, consistently-styled compact nav list rather than a big
            colored button plus a visually unrelated toggle row. */}
        <button
          onClick={handleNewChat}
          className="flex items-center gap-[9px] font-bold text-[13.5px] transition-all mb-[10px]"
          style={{
            background: 'var(--v7-cyan-soft)',
            border: '1px solid var(--v7-cyan-strong)',
            color: 'var(--v7-cyan)',
            padding: '11px 15px',
            borderRadius: '14px',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--v7-cyan-soft)'; e.currentTarget.style.boxShadow = '0 0 20px -6px var(--v7-cyan-strong)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--v7-cyan-soft)'; e.currentTarget.style.boxShadow = 'none'; }}
        >
          <Plus className="w-3.5 h-3.5" />
          New Analysis
        </button>

        {/* Command Center, Workflows, then the Goal/Roadmap show/hide
            toggles — in that order (see build-plan discussion: nav items
            first, toggles last, room left for future nav items between
            Workflows and Goals). */}
        <div className="mb-[18px]" style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <SidebarNavRow icon={LayoutGrid} label="Command Center" onClick={() => setMainView('command-center')} badgeCount={pendingQueueCount} />
          <SidebarNavRow icon={WorkflowIcon} label="Workflows" onClick={() => navigate('/venus/workflows')} />
          <SidebarToggleRow icon={Target} label="Goals" active={showGoalPanel} onClick={toggleGoalPanel} />
          <SidebarToggleRow icon={MapIcon} label="Roadmap" active={showRoadmap} onClick={toggleRoadmap} />
        </div>

        <div className="flex-1 overflow-y-auto min-h-0" style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          {/* Chat History */}
          {sessions.length > 0 && (
            <div className="mb-4">
              <div
                className="text-[10.5px] font-bold uppercase px-[10px] pb-2"
                style={{ color: 'var(--v7-text-mute)', fontFamily: 'var(--v7-font-mono)', letterSpacing: '0.07em' }}
              >
                Today
              </div>
              {sessions.map(s => (
                renamingSessionId === s.id ? (
                  <div key={s.id} className="w-full flex items-center" style={{ padding: '9px 12px' }}>
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => commitRename(s)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitRename(s); }
                        if (e.key === 'Escape') { e.preventDefault(); setRenamingSessionId(null); }
                      }}
                      className="flex-1 min-w-0 text-[13px] font-medium bg-transparent outline-none"
                      style={{ color: 'var(--v7-text)', borderBottom: '1px solid var(--v7-cyan-strong)' }}
                    />
                  </div>
                ) : (
                  <button
                    key={s.id}
                    onClick={() => handleSelectSession(s)}
                    className="w-full group flex items-center justify-between text-left transition-colors text-[13px] font-medium mb-[1px]"
                    style={{
                      padding: '9px 12px',
                      borderRadius: '10px',
                      color: currentSession.id === s.id ? 'var(--v7-text)' : 'var(--v7-text-dim)',
                      background: currentSession.id === s.id ? 'var(--v7-bg-raised-2)' : 'transparent',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--v7-bg-raised-2)'; e.currentTarget.style.color = 'var(--v7-text)'; }}
                    onMouseLeave={e => { if (currentSession.id !== s.id) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--v7-text-dim)'; } }}
                  >
                    <span className="truncate flex-1">{s.title}</span>
                    <span className="flex items-center gap-1 shrink-0 ml-1">
                      <Pencil
                        className="w-3 h-3 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                        onClick={(e) => startRename(s, e)}
                      />
                      <Trash2
                        className="w-3 h-3 opacity-0 group-hover:opacity-60 hover:!opacity-100 text-[var(--red)] transition-opacity"
                        onClick={(e) => handleDeleteSession(s.id, e)}
                      />
                    </span>
                  </button>
                )
              ))}
            </div>
          )}

          {/* Saved Analyses */}
          {Object.keys(savedGroups).length > 0 && (
            <div>
              <div
                className="text-[10.5px] font-bold uppercase px-[10px] pb-2"
                style={{ color: 'var(--v7-text-mute)', fontFamily: 'var(--v7-font-mono)', letterSpacing: '0.07em' }}
              >
                Saved
              </div>
              {(Object.entries(savedGroups) as [SavedAnalysisType, typeof saved][]).map(([type, items]) => (
                <div key={type} className="mb-2">
                  <button
                    onClick={() => toggleGroup(type)}
                    className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors"
                    style={{ color: SAVED_TYPE_COLORS[type] }}
                  >
                    {collapsedGroups.has(type) ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {typeLabel(type)}s ({items.length})
                  </button>
                  {!collapsedGroups.has(type) && items.map(item => (
                    <div
                      key={item.id}
                      onClick={() => handleOpenSaved(item)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleOpenSaved(item); }}
                      className="group flex items-center justify-between px-3 py-1.5 rounded text-xs transition-colors cursor-pointer mb-0.5"
                      style={{ color: 'var(--v7-text-dim)' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--v7-bg-raised-2)'; e.currentTarget.style.color = 'var(--v7-text)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--v7-text-dim)'; }}
                    >
                      <span className="truncate flex-1">{item.title}</span>
                      <Trash2
                        className="w-3 h-3 shrink-0 ml-1 opacity-0 group-hover:opacity-60 hover:!opacity-100 text-[var(--red)] transition-opacity cursor-pointer"
                        onClick={(e) => handleDeleteSaved(item.id, e)}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom Settings */}
        <div style={{ borderTop: '1px solid var(--v7-border)', marginTop: '12px', paddingTop: '14px' }}>
          <button
            onClick={() => navigate('/venus/goals')}
            className="w-full flex items-center gap-[9px] text-[13px] font-medium transition-colors mb-1"
            style={{ color: 'var(--v7-text-dim)', paddingLeft: '8px' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--v7-text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--v7-text-dim)')}
          >
            <Target className="w-3.5 h-3.5" />
            Goals
          </button>
          <button
            onClick={() => navigate('/venus/decisions')}
            className="w-full flex items-center gap-[9px] text-[13px] font-medium transition-colors mb-1"
            style={{ color: 'var(--v7-text-dim)', paddingLeft: '8px' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--v7-text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--v7-text-dim)')}
          >
            <ListChecks className="w-3.5 h-3.5" />
            Decisions
          </button>
          <button
            onClick={() => setShowSettings(v => !v)}
            className="w-full flex items-center gap-[9px] text-[13px] font-medium transition-colors"
            style={{ color: 'var(--v7-text-dim)', paddingLeft: '8px' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--v7-text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--v7-text-dim)')}
          >
            <Settings className="w-3.5 h-3.5" />
            Settings
          </button>

          {showSettings && (
            <div className="mt-2 p-3 rounded-lg" style={{ background: 'var(--v7-bg-raised-2)', border: '1px solid var(--v7-border)' }}>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ fontFamily: 'var(--v7-font-mono)', color: 'var(--v7-text-mute)' }}>
                Groq API Key
              </div>
              <input
                type="password"
                value={groqKey}
                onChange={e => {
                  setGroqKey(e.target.value);
                  localStorage.setItem('ve_groq_key', e.target.value);
                }}
                placeholder="gsk_..."
                className="w-full rounded px-2.5 py-2 text-xs focus:outline-none transition-colors"
                style={{ background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-border)', color: 'var(--v7-text)', fontFamily: 'var(--v7-font-mono)' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--v7-cyan-strong)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--v7-border)')}
              />
              <p className="text-[9px] mt-1.5 leading-relaxed" style={{ fontFamily: 'var(--v7-font-mono)', color: 'var(--v7-text-mute)' }}>
                Get a free key at console.groq.com
              </p>

              <div className="text-[10px] uppercase tracking-wider mb-2 mt-4 pt-3" style={{ fontFamily: 'var(--v7-font-mono)', color: 'var(--v7-text-mute)', borderTop: '1px solid var(--v7-border)' }}>
                Connectors
              </div>
              <ConnectorPicker />
            </div>
          )}
        </div>
      </aside>
      </>
      )}

      {/* Main Chat Area — swaps to Command Center in place, same view New
          Chat itself swaps into (see mainView state), never a separate
          route/page. */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {mainView === 'command-center' ? (
          <CommandCenterSection
            theme={theme}
            onBack={() => setMainView('chat')}
            onOpenThread={handleOpenSavedThread}
            onContinueInChat={handleContinueFromMiniVera}
          />
        ) : (
        <>
        {/* Shared by both composer forms below (empty-state and active-chat) —
            a single hidden input, triggered by whichever paperclip button is
            currently on screen. */}
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.doc,.docx,.txt,.csv,.xls,.xlsx"
          className="hidden"
        />
        <div style={{ padding: isNarrow ? '14px 16px 0' : '14px 32px 0' }}>
          {showGoalPanel && <GoalPanel serverChatId={currentSession.serverChatId} onRequireServerChat={ensureServerChat} />}
          {showRoadmap && <RoadmapTracker chatId={currentSession.serverChatId} />}
        </div>

        {/* Messages */}
        {messages.length === 0 ? (
          // NOTE: the outer div is scrollable and the inner div uses `m-auto`
          // instead of the parent using `justify-center`. A centered flex
          // parent with overflow content clips symmetrically and there is no
          // way to scroll up to reach the clipped top — which is exactly what
          // was hiding the example prompts on shorter viewports. `m-auto`
          // still centers when everything fits, but collapses to 0 and lets
          // the container scroll normally once content is taller than the
          // available space.
          <div className="flex-1 overflow-y-auto flex flex-col items-center text-center relative" style={{ padding: isNarrow ? '32px 16px 32px' : '56px 32px 48px' }}>
            <div
              className="absolute pointer-events-none"
              style={{
                top: '6%', left: '50%', transform: 'translateX(-50%)',
                width: '460px', height: '460px', borderRadius: '50%',
                background: 'radial-gradient(circle, var(--v7-glow-1) 0%, var(--v7-glow-2) 45%, transparent 72%)',
              }}
            ></div>

            <div className="m-auto flex flex-col items-center w-full max-w-[600px] relative">
              {/* Only ever shown on this "new chat" landing view, never
                  overlaid on an in-progress chat thread — a check-in is a
                  start-of-session moment, not something that should follow
                  the founder into every chat they switch to. */}
              <TodayCard />

              <div className="flex items-center gap-3 mb-5">
                <div
                  className="w-14 h-14 flex items-center justify-center relative venus-hero-mark"
                  style={{ borderRadius: '18px', background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-border-strong)' }}
                >
                  <svg viewBox="0 0 24 24" fill="none" className="w-[30px] h-[30px]">
                    <circle cx="12" cy="12" r="9.5" stroke="#3a3d47" strokeWidth="0.8"/>
                    <g transform="rotate(-16 12 12)">
                      <path d="M12 4.5L13.6 12H10.4L12 4.5Z" fill="#00e5b0"/>
                      <path d="M12 19.5L11.1 12H12.9L12 19.5Z" fill="#5b4fe8"/>
                    </g>
                    <circle cx="12" cy="12" r="1.1" fill="var(--v7-bg-raised)" stroke="#3a3d47" strokeWidth="0.5"/>
                  </svg>
                </div>
                <span className="font-extrabold" style={{ fontSize: '28px', letterSpacing: '-0.01em', color: 'var(--v7-text)' }}>Vera</span>
              </div>

              <div
                className="text-[12.5px] font-bold uppercase mb-4"
                style={{ fontFamily: 'var(--v7-font-mono)', letterSpacing: '0.04em', color: 'var(--v7-text-mute)' }}
              >
                What brings you here today?
              </div>

              <h1 className="font-extrabold mb-[14px]" style={{ fontSize: '34px', lineHeight: '1.28', letterSpacing: '-0.01em', color: 'var(--v7-text)' }}>
                The cause behind<br />every{' '}
                <span style={{ background: 'linear-gradient(100deg, var(--v7-cyan), var(--v7-pink))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
                  effect.
                </span>
              </h1>

              <p className="font-medium mb-8" style={{ fontSize: '15px', color: 'var(--v7-text-dim)', maxWidth: '420px', lineHeight: '1.6' }}>
                Vera traces what's actually driving your numbers, so every decision has a reason behind it.
              </p>

              {(pendingAttachment || uploadAttachment.isPending || uploadAttachment.isError) && (
                <AttachmentChip
                  fileName={pendingAttachment?.fileName}
                  previewUrl={attachmentPreview}
                  uploading={uploadAttachment.isPending}
                  error={uploadAttachment.isError ? (uploadAttachment.error instanceof Error ? uploadAttachment.error.message : 'Upload failed') : undefined}
                  onRemove={() => { clearAttachment(); uploadAttachment.reset(); }}
                />
              )}
              <form
                onSubmit={e => { e.preventDefault(); handleSend(); }}
                className="flex items-center gap-[10px] w-full transition-all mb-8"
                style={{ background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-border-strong)', borderRadius: '16px', padding: '5px 5px 5px 18px' }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--v7-cyan-strong)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--v7-cyan-soft)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--v7-border-strong)'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <AttachMenu
                  onPickFiles={() => fileInputRef.current?.click()}
                  className="shrink-0 p-1.5 rounded-lg transition-colors"
                  style={{ color: 'var(--v7-text-mute)' }}
                />
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder="Tell Vera what's really going on…"
                  rows={1}
                  className="flex-1 bg-transparent border-none outline-none resize-none max-h-32 min-h-[38px] py-2 font-medium text-[14.5px]"
                  style={{ color: 'var(--v7-text)', fontFamily: 'var(--v7-font-round)' }}
                />
                <button
                  type="submit"
                  disabled={(!input.trim() && !pendingAttachment) || analyzeMutation.isPending}
                  className="w-[38px] h-[38px] shrink-0 flex items-center justify-center transition-all disabled:opacity-40"
                  style={{ borderRadius: '12px', border: 'none', background: 'var(--v7-cyan)' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--v7-bg)" strokeWidth="2.3">
                    <path d="M7 17L17 7M17 7H9M17 7V15" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </form>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-[10px] w-full">
                {EXAMPLE_PROMPTS.map((prompt, i) => (
                  <button
                    key={prompt}
                    onClick={() => handleSend(prompt)}
                    className="text-left flex items-start gap-3 transition-all group"
                    style={{ background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-border)', borderRadius: '16px', padding: '16px 17px' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--v7-cyan-strong)'; e.currentTarget.style.background = 'var(--v7-bg-raised-2)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--v7-border)'; e.currentTarget.style.background = 'var(--v7-bg-raised)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                  >
                    <div
                      className="w-[30px] h-[30px] rounded-[10px] flex items-center justify-center shrink-0"
                      style={{ background: 'var(--v7-bg-raised-2)' }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke={i % 2 === 0 ? 'var(--v7-cyan)' : 'var(--v7-pink)'}>
                        <path d="M4 19V13M10 19V8M16 19V15M21 19V5" strokeWidth="2.2" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <p className="text-[13px] font-medium leading-[1.45] pt-1" style={{ color: 'var(--v7-text-dim)' }}>
                      {prompt}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-8 space-y-8 max-w-4xl mx-auto w-full">
            {messages.map((msg, i) => {
              const priorUserQuery = messages.slice(0, i).reverse().find(m => m.role === 'user')?.content ?? '';
              return (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'user' ? (
                    <div className="max-w-[70%] bg-[var(--v7-tint)] border border-[var(--v7-tint-border)] text-[var(--text)] rounded-2xl rounded-tr-none px-5 py-3.5 text-sm leading-relaxed">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="max-w-[90%] space-y-3 group">
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <div className="flex items-center gap-2">
                          <VeraAvatar />
                          <span className="text-[10px] font-mono uppercase text-[var(--muted-text)]">Vera</span>
                        </div>
                        {msg.role === 'venus' && !(msg as any).isError && <ConfidenceBadge confidence={msg.confidence} note={msg.confidenceNote} />}
                      </div>

                      {msg.content && <VenusMessage content={msg.content} confidence={msg.confidence} confidenceNote={msg.confidenceNote} />}

                      {msg.cards && msg.cards.length > 0 && (() => {
                        if ((msg as any).isError) {
                          return (
                            <div className="rounded-xl border border-[var(--red)]/30 bg-[var(--red)]/10 p-4 text-sm text-[var(--red)]">
                              <div className="text-[10px] font-mono uppercase tracking-wider mb-2">Error</div>
                              <div>{msg.content}</div>
                            </div>
                          );
                        }
                        const orderedCards = (msg.cards ?? []).map((card: any, index: number) => ({
                          ...card,
                          role: card.role ?? (index === 0 ? 'primary' : 'supporting'),
                        }));
                        const primaryCards = orderedCards.filter((card: any) => card.role === 'primary');
                        const displayCards = primaryCards.length > 0
                          ? [...primaryCards, ...orderedCards.filter((card: any) => card.role !== 'primary')]
                          : orderedCards;

                        return (
                          <>
                            <ResponseJumpNav cards={displayCards} />
                            <div className="grid grid-cols-1 gap-3 mt-2">
                              {displayCards.map((card: any, ci: number) => (
                                <VenusCard
                                  key={`${ci}-${card.title ?? 'card'}`}
                                  card={card}
                                  index={ci}
                                  contextQuery={msg.contextQuery || priorUserQuery}
                                  previousContextQuery={priorUserQuery}
                                  isPrimary={card.role === 'primary' || (primaryCards.length === 0 && ci === 0)}
                                  companyReports={companyReports}
                                  onGenerateCompanyReport={handleGenerateCompanyReport}
                                />
                              ))}
                            </div>
                          </>
                        );
                      })()}

                      {/* Response actions: copy markdown, download .md, save */}
                      <VenusResponseActions msg={msg} onSave={() => handleSaveResponse(msg)} />
                    </div>
                  )}
                </div>
              );
            })}

            {analyzeMutation.isPending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-3">
                  <VeraAvatar pulse />
                  <div className="flex gap-1">
                    {[0, 150, 300].map(delay => (
                      <span key={delay} className="w-1.5 h-1.5 bg-[var(--mint)] rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}

        {/* Input */}
        {messages.length > 0 && (
          <div className="p-4 border-t border-[var(--border)] bg-[var(--bg)] shrink-0">
            {(pendingAttachment || uploadAttachment.isPending || uploadAttachment.isError) && (
              <div className="max-w-4xl mx-auto mb-2">
                <AttachmentChip
                  fileName={pendingAttachment?.fileName}
                  previewUrl={attachmentPreview}
                  uploading={uploadAttachment.isPending}
                  error={uploadAttachment.isError ? (uploadAttachment.error instanceof Error ? uploadAttachment.error.message : 'Upload failed') : undefined}
                  onRemove={() => { clearAttachment(); uploadAttachment.reset(); }}
                />
              </div>
            )}
            <form
              onSubmit={e => { e.preventDefault(); handleSend(); }}
              className="flex items-end gap-2 bg-[var(--surface2)] border border-[var(--border)] rounded-xl p-2 focus-within:border-[var(--indigo)] transition-colors max-w-4xl mx-auto"
            >
              <AttachMenu
                onPickFiles={() => fileInputRef.current?.click()}
                className="shrink-0 w-10 h-10 flex items-center justify-center rounded-lg transition-colors mb-0.5"
                style={{ color: 'var(--dim)' }}
              />
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Ask Vera for unvarnished analysis..."
                rows={1}
                className="flex-1 bg-transparent border-none outline-none resize-none max-h-32 min-h-[44px] py-3 px-4 text-sm text-[var(--text)] placeholder-[var(--dim)]"
              />
              <button
                type="submit"
                disabled={(!input.trim() && !pendingAttachment) || analyzeMutation.isPending}
                className="w-10 h-10 shrink-0 bg-[var(--indigo)] hover:bg-[var(--indigo-light)] disabled:opacity-40 text-white rounded-lg flex items-center justify-center transition-colors mb-0.5 mr-0.5"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
                </svg>
              </button>
            </form>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}

// Server-side sanitization (sanitizeVenusResponse in the API) already strips
// markdown headings/fences/list markers out of the summary text before it
// ever reaches the client. This is a defense-in-depth pass on the frontend
// in case older cached sessions (saved analyses from before the server fix
// shipped) or any other response path still contains raw fenced code blocks
// — without this, a stray ```json ... ``` block renders as visible plain
// text lines instead of being hidden, which is what produced the empty
// "### Card" / "{}" lines seen in the UI.
function stripStrayCodeFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/```[\s\S]*$/g, '');
}

// The compass brand mark, shrunk to fit the per-message avatar slot —
// replaces a plain gradient circle with "V" in it so every Vera response
// carries the same mark as the sidebar/hero, in both themes. Needle colors
// stay fixed brand colors (not theme-driven, same choice as the sidebar
// mark); the ring and center dot use --v7-* tokens so they still blend
// into the badge correctly whichever theme is active.
function VeraAvatar({ pulse = false }: { pulse?: boolean }) {
  return (
    <div
      className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center${pulse ? ' animate-pulse' : ''}`}
      style={{ background: 'var(--v7-bg-raised-2)', border: '1px solid var(--v7-border-strong)' }}
    >
      <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3">
        <circle cx="12" cy="12" r="9.5" stroke="#3a3d47" strokeWidth="1" />
        <g transform="rotate(-16 12 12)">
          <path d="M12 4.5L13.6 12H10.4L12 4.5Z" fill="#00e5b0" />
          <path d="M12 19.5L11.1 12H12.9L12 19.5Z" fill="#5b4fe8" />
        </g>
        <circle cx="12" cy="12" r="1.3" fill="var(--v7-bg-raised-2)" stroke="#3a3d47" strokeWidth="0.6" />
      </svg>
    </div>
  );
}

/* Render Venus response with basic markdown-like formatting */
function VenusMessage({ content, confidence }: { content: string; confidence?: 'verified' | 'exploratory'; confidenceNote?: string }) {
  const withoutFences = stripStrayCodeFences(content);
  const stripped = confidence === 'exploratory'
    ? withoutFences.replace(/^⚠️ No verified precedent match — (the answer below|this) is general strategic reasoning, not backed by (Vera|Venus AI)'s dataset\.\s*(Treat (it as|as) an? (useful starting point|unverified starting point only)[^.]*\.)?\s*/i, '').trim()
    : withoutFences;
  const lines = stripped.split('\n').filter((line) => line.trim() !== '```' && line.trim() !== '```json');
  return (
    <div className="space-y-1.5 text-sm text-[var(--text)] leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith('### ')) {
          return <h3 key={i} className="text-xs font-mono text-[var(--mint)] uppercase tracking-wider pt-3 first:pt-0">{line.slice(4)}</h3>;
        }
        if (line.startsWith('## ')) {
          return <h2 key={i} className="text-sm font-syne font-bold text-[var(--text)] pt-3 first:pt-0">{line.slice(3)}</h2>;
        }
        if (line.startsWith('# ')) {
          return <h1 key={i} className="text-base font-syne font-extrabold text-[var(--text)] pt-2 first:pt-0">{line.slice(2)}</h1>;
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <div key={i} className="flex items-start gap-2">
              <span className="text-[var(--mint)] mt-0.5 text-xs shrink-0">•</span>
              <span>{renderInline(line.slice(2))}</span>
            </div>
          );
        }
        if (/^\d+\.\s/.test(line)) {
          const num = line.match(/^(\d+)\.\s/)![1];
          return (
            <div key={i} className="flex items-start gap-2">
              <span className="text-[var(--dim)] font-mono text-xs shrink-0 pt-0.5">{num}.</span>
              <span>{renderInline(line.replace(/^\d+\.\s/, ''))}</span>
            </div>
          );
        }
        if (line.trim() === '') return <div key={i} className="h-1" />;
        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

const FIGURE_SPLIT_RE = /(\$\d[\d,.]*\s?[KMBT]?|\d[\d,.]*\s?%|\b\d[\d,.]*x\b|\b(?:19|20)\d{2}\b)/g;
const FIGURE_TEST_RE = /^(\$\d[\d,.]*\s?[KMBT]?|\d[\d,.]*\s?%|\d[\d,.]*x|(?:19|20)\d{2})$/;

function highlightFigures(text: string): React.ReactNode {
  const parts = text.split(FIGURE_SPLIT_RE);
  return parts.map((p, i) =>
    p && FIGURE_TEST_RE.test(p) ? (
      <span key={i} className="font-mono text-[var(--mint)] font-medium">{p}</span>
    ) : (
      p
    ),
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-[var(--text)] font-semibold">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{highlightFigures(part)}</span>;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getCompetitorLabel(competitor: unknown): string {
  if (typeof competitor === 'string') return competitor.trim() || 'Unknown competitor';
  if (!isRecord(competitor)) return 'Unknown competitor';
  const name = typeof competitor.name === 'string' ? competitor.name.trim() : '';
  const description = typeof competitor.description === 'string' ? competitor.description.trim() : '';
  const marketShare = competitor.marketShare != null ? String(competitor.marketShare) : '';
  if (name && description) return `${name} — ${description}`;
  if (name && marketShare) return `${name} — ${marketShare}`;
  return name || 'Unknown competitor';
}

function isMarketQueryRelevant(query: string): boolean {
  const normalized = query.toLowerCase();
  return /\b(market|competitor|competition|tam|sam|som|growth|sizing|size|opportunity|demand|landscape|category)\b/.test(normalized);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function renderStructuredValue(value: unknown, depth = 0): React.ReactNode {
  const parsed = parseMaybeJson(value);
  if (typeof parsed === 'string') {
    return <span>{renderInline(parsed)}</span>;
  }
  if (typeof parsed === 'number' || typeof parsed === 'boolean') {
    return <span className="font-mono text-[var(--text)]">{String(parsed)}</span>;
  }
  if (Array.isArray(parsed)) {
    return (
      <ul className="space-y-1.5 list-disc pl-5">
        {parsed.map((item, index) => (
          <li key={index} className="text-sm text-[var(--text)]">
            {renderStructuredValue(item, depth + 1)}
          </li>
        ))}
      </ul>
    );
  }
  if (isRecord(parsed)) {
    const entries = Object.entries(parsed);
    if (entries.length === 0) return null;
    return (
      <div className="space-y-2">
        {entries.map(([key, entryValue]) => (
          <div key={key} className="rounded border border-[var(--border)] bg-[var(--surface)]/70 p-2.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted-text)] mb-1">{key.replace(/_/g, ' ')}</div>
            <div className="text-sm text-[var(--text)]">{renderStructuredValue(entryValue, depth + 1)}</div>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

function normalizeCompetitors(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (!trimmed) return [];
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return normalizeCompetitors(parsed);
          }
          if (isRecord(parsed)) {
            return [formatCompetitor(parsed)];
          }
        } catch {
          return [trimmed];
        }
        return [trimmed];
      }
      if (isRecord(item)) {
        return [formatCompetitor(item)];
      }
      return [String(item)];
    });
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeCompetitors(parsed);
    } catch {
      return [trimmed];
    }
  }

  return [];
}

function formatCompetitor(competitor: Record<string, unknown>): string {
  const name = typeof competitor.name === 'string' && competitor.name.trim()
    ? competitor.name.trim()
    : typeof competitor.company === 'string' && competitor.company.trim()
      ? competitor.company.trim()
      : typeof competitor.title === 'string' && competitor.title.trim()
        ? competitor.title.trim()
        : 'Competitor';
  const description = typeof competitor.description === 'string' && competitor.description.trim()
    ? competitor.description.trim()
    : typeof competitor.summary === 'string' && competitor.summary.trim()
      ? competitor.summary.trim()
      : typeof competitor.notes === 'string' && competitor.notes.trim()
        ? competitor.notes.trim()
        : '';
  const marketShare = competitor.marketShare != null ? String(competitor.marketShare) : '';
  if (description && marketShare) return `${name} — ${description} (${marketShare})`;
  if (description) return `${name} — ${description}`;
  if (marketShare) return `${name} — ${marketShare}`;
  return name;
}

function CompetitorList({ competitors }: { competitors: unknown }) {
  if (import.meta.env.DEV) {
    console.debug('[Venus] competitor payload', competitors);
  }
  const normalized = normalizeCompetitors(competitors);
  if (normalized.length === 0) return null;
  return (
    <ul className="space-y-1.5 list-disc pl-5 text-sm text-[var(--muted-text)]">
      {normalized.map((item, idx) => (
        <li key={`${item}-${idx}`}>{renderInline(item)}</li>
      ))}
    </ul>
  );
}

function ConfidenceBadge({ confidence, note }: { confidence?: 'verified' | 'exploratory'; note?: string }) {
  // No confidence value means this message isn't a real analysis — a plain
  // acknowledgment ("noted your context") or a clarifying question ("which
  // business do you mean"). Previously this fell through to the "false"
  // branch below and rendered a "Verified precedent" badge on messages that
  // were never any kind of precedent-backed answer at all, which was
  // confusing and made a plain follow-up question look like a confident
  // analytical claim. Render nothing in that case.
  if (!confidence) return null;

  const isExploratory = confidence === 'exploratory';
  const label = isExploratory ? 'Exploratory — no precedent match' : 'Verified precedent';
  const classes = isExploratory
    ? 'border-[var(--v7-tint-border)] bg-[var(--v7-tint)] text-[var(--amber)]'
    : 'border-[var(--v7-tint-border)] bg-[var(--v7-tint)] text-[var(--mint)]';

  return (
    <div className="relative group shrink-0">
      <button type="button" className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors ${classes}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${isExploratory ? 'bg-[var(--amber)]' : 'bg-[var(--mint)]'}`} />
        {label}
      </button>
      {note && (
        <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-64 rounded-lg border border-[var(--border)] bg-[var(--surface2)] p-2.5 text-[11px] leading-relaxed text-[var(--muted-text)] shadow-lg group-hover:block group-focus-within:block">
          {note}
        </div>
      )}
    </div>
  );
}

function ResponseJumpNav({ cards }: { cards: any[] }) {
  // With a single card the "nav" is one chip sitting directly above the very
  // heading it links to — the title rendered twice, two lines apart, for no
  // navigational gain. Jumping only earns its space once there's somewhere
  // to jump to.
  if (cards.length < 2) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface2)]/80 p-2">
      {cards.map((card, index) => (
        <a key={index} href={`#venus-card-${index}`} className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--dim)] hover:border-[var(--indigo)] hover:text-[var(--text)]">
          {card.title?.replace(/\s+/g, ' ').trim() || `Section ${index + 1}`}
        </a>
      ))}
    </div>
  );
}

// Renders a single precedent entry (e.g. one company in a precedent card) with its
// own independent "Show report / Hide report" toggle. Previously this toggle lived
// on the parent VenusCard and was shared across every precedent rendered inside it,
// so clicking "Show report" on one company (e.g. Ask Jeeves) also revealed the report
// panel for every other unrelated company in the same card (e.g. Zume). Each entry now
// owns its own state so toggling one never affects the others.
function PrecedentEntry({ precedent: p, companyReports, onGenerateCompanyReport }: { precedent: any; companyReports: Record<string, CompanyReportState>; onGenerateCompanyReport: (companyName: string) => Promise<void> }) {
  const [reportExpanded, setReportExpanded] = useState(false);
  const reportKey = p.company ? normalizeCompanyKey(String(p.company)) : null;
  const reportState = reportKey ? companyReports[reportKey] : undefined;

  return (
    <div className="relative bg-[var(--surface)] border-l-2 border border-[var(--mint)]/40 border-l-[var(--mint)] rounded-r-lg rounded-l-sm p-4 pl-[18px]">
      <div className="flex items-baseline justify-between gap-3 mb-1.5 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="font-syne font-bold text-[15px] text-[var(--text)]">{p.company}</span>
          <span className="font-mono text-[11px] text-[var(--mint)]">{p.year}</span>
        </div>
        {p.outcome && (
          <span className="text-[9.5px] uppercase font-mono px-2 py-0.5 rounded bg-[var(--v7-tint)] text-[var(--mint)] tracking-wider">
            {p.outcome}
          </span>
        )}
      </div>
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--dim)] mb-1">Causal lesson</div>
      <p className="text-[13px] text-[var(--muted-text)] leading-relaxed">{renderInline(p.lesson)}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            if (!p.company) return;
            if (reportState?.status === 'loading') return;
            if (reportState?.status === 'ready') {
              setReportExpanded(v => !v);
              return;
            }
            setReportExpanded(true);
            await onGenerateCompanyReport(String(p.company));
          }}
          className="rounded border border-[var(--v7-tint-border)] bg-[var(--v7-tint)] px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--mint)] disabled:cursor-wait disabled:opacity-70"
          disabled={reportState?.status === 'loading'}
        >
          {reportState?.status === 'loading' ? 'Researching…' : reportState?.status === 'ready' ? (reportExpanded ? 'Hide report' : 'Show report') : 'Generate Report'}
        </button>
      </div>

      {reportExpanded && reportState && (
        <div className="mt-3 rounded border border-[var(--border)] bg-[var(--surface)]/70 p-3">
          {reportState.status === 'loading' && <div className="text-sm text-[var(--muted-text)]">Gathering public details and sources…</div>}
          {reportState.status === 'error' && <div className="text-sm text-[var(--red)]">{reportState.error ?? 'Report generation failed.'}</div>}
          {reportState.status === 'ready' && reportState.report && (
            <div className="space-y-3">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--dim)] mb-1">Snapshot</div>
                <div className="space-y-1 text-sm text-[var(--muted-text)]">
                  {reportState.report.snapshot.foundedYear && <div>Founded: {renderInline(reportState.report.snapshot.foundedYear)}</div>}
                  {reportState.report.snapshot.founders && reportState.report.snapshot.founders.length > 0 && <div>Founders: {renderInline(reportState.report.snapshot.founders.join(', '))}</div>}
                  {reportState.report.snapshot.fundingRaised && <div>Funding: {renderInline(reportState.report.snapshot.fundingRaised)}</div>}
                  {reportState.report.snapshot.whatTheyBuilt && <div>Built: {renderInline(reportState.report.snapshot.whatTheyBuilt)}</div>}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--dim)] mb-1">Timeline</div>
                <ul className="space-y-1.5 list-disc pl-5 text-sm text-[var(--muted-text)]">
                  {reportState.report.timeline.map((entry, entryIndex) => (
                    <li key={`${entry.label}-${entryIndex}`}><span className="text-[var(--text)]">{entry.label}</span>: {renderInline(entry.detail)}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--dim)] mb-1">What happened</div>
                <p className="text-sm text-[var(--muted-text)] leading-relaxed">{renderInline(reportState.report.analysis)}</p>
              </div>
              {reportState.report.sources.length > 0 && (
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--dim)] mb-1">Sources</div>
                  <ul className="space-y-1 text-sm">
                    {reportState.report.sources.map((source, sourceIndex) => (
                      <li key={`${source.url}-${sourceIndex}`}>
                        <a href={source.url} target="_blank" rel="noreferrer" className="text-[var(--mint)] hover:text-[var(--text)] underline decoration-dotted">
                          {source.title || source.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Explicit colors for topics that recur often enough to deserve a fixed,
// predictable meaning (a founder should be able to learn "orange = roadmap"
// once and have it hold). Everything else previously fell back to a single
// flat gray/indigo, which is what made every new topic outside this list
// blur into the same look. NEON_PALETTE + hashCardType below fixes that:
// an unrecognized type still gets a real, saturated color, just picked
// deterministically from its own name so the SAME new topic always renders
// the same color across cards/renders instead of a random one each time.
const CARD_TYPE_COLORS: Record<string, string> = {
  analysis: 'var(--indigo-light)',
  market: 'var(--mint)',
  risk: 'var(--red)',
  roadmap: 'var(--amber)',
  decision: 'var(--green)',
  precedent: 'var(--mint)',
  funnel: 'var(--indigo-light)',
  solution: 'var(--green)',
  funding: 'var(--green)',
  fundraising: 'var(--green)',
  hypothesis: 'var(--indigo-light)',
};

const NEON_PALETTE = ['#2ce8d6', '#ff7ad1', '#f6c945', '#5b9df9', '#ff8a5c', '#7cf6a0', '#c084fc', '#38e0c8', '#ffb454'];

function hashCardType(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function getCardColor(type: string): string {
  const key = (type || '').toLowerCase().trim();
  if (CARD_TYPE_COLORS[key]) return CARD_TYPE_COLORS[key];
  return NEON_PALETTE[hashCardType(key) % NEON_PALETTE.length];
}

function VenusCard({ card, index = 0, contextQuery = '', previousContextQuery = '', isPrimary = false, companyReports, onGenerateCompanyReport }: { card: any; index?: number; contextQuery?: string; previousContextQuery?: string; isPrimary?: boolean; companyReports: Record<string, CompanyReportState>; onGenerateCompanyReport: (companyName: string) => Promise<void> }) {
  const [expanded, setExpanded] = useState(isPrimary);
  const color = getCardColor(card.type);
  const content = parseMaybeJson(card.content);
  const normalizedContent: Record<string, any> = isRecord(content) ? content : { value: content };
  const shouldRenderMarket = card.type !== 'market' || isMarketQueryRelevant(contextQuery);
  const changedScopeNote = previousContextQuery && contextQuery && previousContextQuery !== contextQuery ? 'Refined for current scope' : null;
  const primary = Boolean(isPrimary || card.role === 'primary');
  const precedentCompany = card.type === 'precedent' ? (typeof normalizedContent.precedents?.[0]?.company === 'string' ? normalizedContent.precedents[0].company : null) : null;
  const companyReportKey = precedentCompany ? normalizeCompanyKey(precedentCompany) : null;
  const companyReportState = companyReportKey ? companyReports[companyReportKey] : undefined;

  if (!shouldRenderMarket) return null;

  const body = (
    <div className="mt-4 space-y-4">
      {changedScopeNote && (
        <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mint)]">{changedScopeNote}</div>
      )}

      {card.type === 'analysis' && (
        <ul className="space-y-3">
          {(normalizedContent.points ?? []).map((pt: any, i: number) => (
            <li key={i} className="flex flex-col gap-1 text-sm border-b border-[var(--border)] border-dashed pb-3 last:border-0">
              <span className="text-[var(--dim)] text-[11px] font-mono uppercase tracking-wide">{pt.label}</span>
              <span className="text-[var(--text)] leading-relaxed">{pt.value}</span>
            </li>
          ))}
        </ul>
      )}

      {card.type === 'risk' && (
        <div className="space-y-3">
          {(normalizedContent.risks ?? []).map((risk: any, i: number) => (
            <div key={i} className="bg-[var(--surface)] p-3 rounded border border-[var(--border)]">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-sm font-bold text-[var(--text)]">{risk.name}</span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-[var(--red)] text-white">{risk.impact}</span>
              </div>
              <p className="text-xs text-[var(--muted-text)]">{risk.mitigation}</p>
            </div>
          ))}
        </div>
      )}

      {card.type === 'roadmap' && (
        <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
          {normalizedContent.horizon && (
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--dim)]">Horizon: {String(normalizedContent.horizon)}</div>
          )}
          {(normalizedContent.phases ?? normalizedContent.milestones ?? []).map((rawPhase: any, i: number) => {
            // FIX: the model doesn't always return every phase at the same
            // nesting depth — some phases arrive as real objects, others as
            // a JSON-encoded STRING of the same shape (inconsistent across
            // a single response, not just across responses). `m.title` on a
            // string is always undefined, which made hasExpectedFields false
            // for exactly those phases and dumped them through
            // renderStructuredValue's generic per-field-box fallback instead
            // of the real template below — the "some phases look fine, others
            // are gray boxes with no header" bug. parseMaybeJson normalizes
            // BOTH shapes to a real object before any field is read, so every
            // phase (regardless of how the model nested it) renders through
            // the same styled template.
            const parsedPhase = parseMaybeJson(rawPhase);
            const m: Record<string, any> = isRecord(parsedPhase) ? parsedPhase : {};
            const hasExpectedFields = Boolean(m.title) || (Array.isArray(m.actions) && m.actions.length > 0) || Boolean(m.metric);
            const summaryLine = m.goal ?? m.description ?? (hasExpectedFields ? null : renderStructuredValue(m));
            const metricValue = m.metric != null ? (typeof m.metric === 'string' ? m.metric : JSON.stringify(m.metric)) : null;
            return (
              <div key={i} className="rounded border border-[var(--border)] bg-[var(--surface)]/60 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <div className="font-mono text-[var(--amber)] text-xs">{m.period ?? m.phase ?? `Phase ${i + 1}`}</div>
                  {m.title && <div className="text-sm font-semibold text-[var(--text)]">{m.title}</div>}
                </div>
                {summaryLine && <div className="text-sm text-[var(--text)] mb-2">{summaryLine}</div>}
                {m.actions && Array.isArray(m.actions) && m.actions.length > 0 && (
                  <ul className="space-y-1.5 list-disc pl-5 text-sm text-[var(--text)] mt-2">
                    {m.actions.map((action: unknown, actionIndex: number) => {
                      const parsedAction = parseMaybeJson(action);
                      const text = typeof parsedAction === 'string' ? parsedAction : isRecord(parsedAction) ? (parsedAction.text ?? parsedAction.action ?? JSON.stringify(parsedAction)) : String(action);
                      return <li key={actionIndex}>{renderInline(String(text))}</li>;
                    })}
                  </ul>
                )}
                {metricValue && <div className="mt-2 text-[11px] font-mono text-[var(--mint)]">Metric: {renderInline(metricValue)}</div>}
              </div>
            );
          })}
        </div>
      )}

      {card.type === 'precedent' && (
        <div className="space-y-3">
          {(normalizedContent.precedents ?? []).map((p: any, i: number) => (
            <PrecedentEntry
              key={i}
              precedent={p}
              companyReports={companyReports}
              onGenerateCompanyReport={onGenerateCompanyReport}
            />
          ))}
        </div>
      )}

      {card.type === 'market' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {[
              ['TAM', normalizedContent.tam],
              ['SAM', normalizedContent.sam],
              ['SOM', normalizedContent.som],
              ['Growth', normalizedContent.growth],
            ].filter(([, value]) => value != null && value !== '').map(([label, value]) => (
              <div key={label} className="rounded border border-[var(--border)] bg-[var(--surface)]/70 p-2.5">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--dim)] mb-1">{label}</div>
                <div className="text-sm text-[var(--text)] font-mono">{String(value)}</div>
              </div>
            ))}
          </div>
          {normalizedContent.competitors != null && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--dim)] mb-2">Competitors</div>
              <CompetitorList competitors={normalizedContent.competitors} />
            </div>
          )}
          {normalizedContent.whitespace && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--dim)] mb-2">Whitespace</div>
              <div className="text-sm text-[var(--muted-text)]">{renderInline(String(normalizedContent.whitespace))}</div>
            </div>
          )}
        </div>
      )}

      {card.type === 'decision' && (
        <div className="space-y-3">
          {normalizedContent.recommendation && (
            <div className="rounded border border-[var(--v7-tint-border)] bg-[var(--v7-tint)] p-3">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mint)] mb-1">Recommendation</div>
              <div className="text-sm text-[var(--muted-text)]">{renderInline(String(normalizedContent.recommendation))}</div>
            </div>
          )}
          {(normalizedContent.options ?? []).map((option: any, i: number) => {
            // "reasoning" is the current schema field (prose, primary content);
            // "verdict" is kept as a fallback for any response still on the
            // older one-line schema so existing/cached responses still render.
            const reasoningText = option.reasoning ?? option.verdict;
            return (
              <div key={i} className="rounded border border-[var(--border)] bg-[var(--surface)]/60 p-3">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <div className="font-semibold text-[var(--text)]">{option.name ?? `Option ${i + 1}`}</div>
                  {option.chosen === true && (
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mint)] rounded border border-[var(--v7-tint-border)] bg-[var(--v7-tint)] px-1.5 py-0.5">Recommended</span>
                  )}
                </div>
                {reasoningText && (
                  <div className="text-sm text-[var(--text)] leading-relaxed">{renderInline(String(reasoningText))}</div>
                )}
                {option.scores && isRecord(option.scores) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 pt-2 border-t border-[var(--border)]/60">
                    {Object.entries(option.scores).map(([scoreKey, scoreValue]) => (
                      <div key={scoreKey} className="flex items-baseline gap-1">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--dim)]">{scoreKey.replace(/_/g, ' ')}</span>
                        <span className="text-xs font-mono text-[var(--dim)]">{String(scoreValue)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {card.type === 'funnel' && (
        <div className="space-y-2">
          {(normalizedContent.stages ?? normalizedContent.steps ?? []).map((stage: any, stageIndex: number) => (
            <div key={stageIndex} className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 p-3">
              <div className="flex items-start gap-2">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--v7-tint)] text-[10px] font-mono text-[var(--indigo-light)]">{stageIndex + 1}</div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--text)]">{renderInline(String(stage.stage_title ?? stage.title ?? stage.name ?? 'Stage'))}</div>
                  <div className="mt-1 text-sm text-[var(--muted-text)] leading-snug">{renderInline(String(stage.stage_detail ?? stage.detail ?? stage.description ?? ''))}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {card.type === 'solution' && (
        <div className="space-y-2">
          {(normalizedContent.solutions ?? normalizedContent.options ?? []).map((solution: any, solutionIndex: number) => (
            <div key={solutionIndex} className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 p-3">
              <div className="text-sm font-semibold text-[var(--text)]">{renderInline(String(solution.stage_title ?? solution.title ?? solution.name ?? 'Solution'))}</div>
              <div className="mt-1 text-sm text-[var(--muted-text)] leading-snug">{renderInline(String(solution.stage_detail ?? solution.detail ?? solution.description ?? ''))}</div>
            </div>
          ))}
        </div>
      )}

      {!['analysis', 'risk', 'roadmap', 'precedent', 'market', 'decision', 'funnel', 'solution'].includes(card.type) && (
        <div className="space-y-2">
          {renderStructuredValue(normalizedContent)}
        </div>
      )}
    </div>
  );

  return (
    <div id={`venus-card-${index}`} className={`bg-[var(--surface2)] border border-[var(--border2)] rounded-lg p-5 overflow-hidden ${primary ? 'ring-1 ring-[var(--v7-tint)] border-[var(--v7-tint-border)]' : ''}`}>
      {primary ? (
        <div>
          <div className="flex items-start justify-between gap-3 text-left">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
              <h4 className="text-xs font-mono uppercase tracking-wider" style={{ color }}>{card.title?.trim() || `Section ${index + 1}`}</h4>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--dim)]">Primary answer</span>
          </div>
          {body}
        </div>
      ) : (
        <>
          <button type="button" onClick={() => setExpanded(v => !v)} className="flex w-full items-start justify-between gap-3 text-left">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
              <h4 className="text-xs font-mono uppercase tracking-wider" style={{ color }}>{card.title?.trim() || `Section ${index + 1}`}</h4>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--dim)]">{expanded ? 'Hide' : 'Show'}</span>
          </button>
          {expanded && body}
        </>
      )}
    </div>
  );
}

/* ---- Plain-text export (copy/download) ---------------------------------- */
// Deliberately NOT markdown — this is read by a human pasting into Slack, a
// doc, or a plain notes app, not rendered by a markdown engine, so `**bold**`
// and `- ` bullets just show up as literal asterisks and dashes. Plain
// indentation, real bullet characters, and a readable JSON fallback for any
// card type this doesn't have a specific formatter for.

function indentText(depth: number): string {
  return '  '.repeat(depth);
}

function formatPlainValue(value: unknown, depth = 0): string {
  if (value == null || value === '') return '';
  if (Array.isArray(value)) {
    return value.map((item) => `${indentText(depth)}• ${formatPlainValue(item, depth + 1).trim()}`).join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => `${indentText(depth)}${key.replace(/_/g, ' ')}: ${formatPlainValue(entryValue, depth + 1).trim()}`)
      .join('\n');
  }
  return String(value);
}

// Same normalization the JSX roadmap renderer needed: the model doesn't
// always return every list item (a phase, a risk, an option...) at the same
// nesting depth in the same response — some arrive as real objects, others
// as a JSON-encoded STRING of the same shape. Reading `.label`/`.title`/etc
// straight off a string is always undefined, which is what produced the
// bare "•" lines with nothing after them in a copied/downloaded roadmap —
// not missing data, just unparsed data. Every per-item access below goes
// through this first.
function asItem(value: unknown): Record<string, any> {
  const parsed = parseMaybeJson(value);
  return isRecord(parsed) ? parsed : {};
}

function actionText(action: unknown): string {
  const parsed = parseMaybeJson(action);
  if (typeof parsed === 'string') return parsed;
  if (isRecord(parsed)) return String(parsed.text ?? parsed.action ?? '');
  return action == null ? '' : String(action);
}

function cardToText(card: any): string {
  const c = card?.content ?? {};
  const lines: string[] = [(card.title ?? 'Card').toUpperCase()];

  switch (card.type) {
    case 'analysis':
      (c.points ?? []).forEach((raw: unknown) => {
        const p = asItem(raw);
        lines.push(`• ${p.label}: ${p.value}`);
      });
      break;
    case 'risk':
      (c.risks ?? []).forEach((raw: unknown) => {
        const r = asItem(raw);
        lines.push(`• ${r.name} (${r.impact}${r.probability != null ? `, ${r.probability}%` : ''}) — ${r.mitigation}`);
      });
      break;
    case 'roadmap':
      (c.milestones ?? c.phases ?? []).forEach((raw: unknown) => {
        const m = asItem(raw);
        const head = m.period ?? m.phase ?? '';
        const title = m.title ? ` — ${m.title}` : '';
        const summary = m.goal ?? m.description;
        lines.push(`• ${head}${title}${summary ? `: ${summary}` : ''}`);
        (m.actions ?? []).forEach((a: unknown) => {
          const text = actionText(a);
          if (text) lines.push(`    - ${text}`);
        });
        if (m.metric) lines.push(`    Success metric: ${typeof m.metric === 'string' ? m.metric : JSON.stringify(m.metric)}`);
      });
      break;
    case 'market':
      if (c.tam || c.sam || c.som || c.growth)
        lines.push(`TAM ${c.tam ?? '—'} · SAM ${c.sam ?? '—'} · SOM ${c.som ?? '—'} · Growth ${c.growth ?? '—'}`);
      (c.competitors ?? []).forEach((x: unknown) => lines.push(`• ${actionText(x)}`));
      if (c.whitespace) lines.push(`Whitespace: ${c.whitespace}`);
      break;
    case 'decision':
      (c.options ?? []).forEach((raw: unknown) => {
        const o = asItem(raw);
        lines.push(`• ${o.name}: ${o.verdict ?? ''}`);
      });
      if (c.recommendation) lines.push(`Recommendation: ${c.recommendation}`);
      break;
    case 'precedent':
      (c.precedents ?? []).forEach((raw: unknown) => {
        const p = asItem(raw);
        lines.push(`• ${p.company} (${p.year}${p.outcome ? `, ${p.outcome}` : ''}): ${p.lesson}`);
      });
      break;
    default:
      lines.push(formatPlainValue(c));
  }

  // Defense in depth: even after normalizing above, a genuinely malformed
  // item (missing every expected field) can still produce a bullet with
  // nothing after it — never emit that line in the exported text.
  return lines.filter((line) => line.replace(/^[\s•\-]+/, '').trim().length > 0).join('\n');
}

function messageToText(msg: ChatMessage): string {
  const parts: string[] = ['VERA ANALYSIS', ''];
  if (msg.content) parts.push(msg.content, '');
  (msg.cards ?? []).forEach((card: any) => {
    parts.push(cardToText(card), '');
  });
  parts.push('—', `Generated by Vera · ${new Date().toLocaleString()}`);
  return parts.join('\n');
}

function VenusResponseActions({ msg, onSave }: { msg: ChatMessage; onSave: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(messageToText(msg));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleDownload = () => {
    const blob = new Blob([messageToText(msg)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `venus-analysis-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleSave = () => {
    onSave();
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const btn =
    'flex items-center gap-1.5 text-[10px] font-mono text-[var(--dim)] hover:text-[var(--mint)] transition-colors border border-[var(--border)] hover:border-[var(--mint)]/40 px-2.5 py-1 rounded';

  return (
    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity pt-1">
      <button onClick={handleCopy} className={btn} title="Copy">
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button onClick={handleDownload} className={btn} title="Download">
        <Download className="w-3 h-3" />
        Download
      </button>
      <button onClick={handleSave} className={btn} title="Save to library">
        <Check className={`w-3 h-3 ${saved ? 'text-[var(--mint)]' : ''}`} />
        {saved ? 'Saved' : `Save as ${typeLabel(detectAnalysisType(msg.content ?? '', msg.cards))}`}
      </button>
    </div>
  );
}