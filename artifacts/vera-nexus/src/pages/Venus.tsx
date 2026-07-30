import { useVenusAnalyze, useCreateChat, useUpdateChat } from '@workspace/api-client-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import {
  getSessions, saveSession, deleteSession, createSession,
  getSavedAnalyses, saveAnalysis, deleteSavedAnalysis,
  detectAnalysisType, typeLabel, titleFromMessage, takePendingChatId,
  type ChatSession, type ChatMessage, type SavedAnalysisType, type SavedAnalysis,
  type EvidenceRefEntry, type ContradictionEntry,
} from '../lib/venusHistory';
import { Settings, Plus, Trash2, ChevronDown, ChevronRight, Copy, Download, Check, Target, ListChecks, Map as MapIcon, PanelLeftClose, PanelLeftOpen, Pencil, LayoutGrid, Workflow as WorkflowIcon, Paperclip, X, Loader2, AlertCircle, Fingerprint, GitBranch, ShieldAlert, TrendingDown, Landmark, Tag } from 'lucide-react';
import { DraftWorkspace, detectDraftChannel } from './DraftWorkspace';
import { VeraMark } from '../components/VeraMark';
import { GoalPanel } from './GoalPanel';
import { RoadmapTracker } from './RoadmapTracker';
import { TodayCard } from './TodayCard';
import { VenusThemeToggle } from './VenusThemeToggle';
import { NotificationBell } from './NotificationBell';
import { CommandCenterSection } from './CommandCenter';
import { AttachMenu } from './AttachMenu';
import { VeraSettingsModal } from './VeraSettingsModal';
import { useVenusTheme } from '../lib/venusTheme';
import { useVeraSkin } from '../lib/veraSkin';
import { useUploadAttachment, useQueue, type UploadedAttachment } from '../lib/venusApi';

// One consistent compact row shape for everything below New Chat — replaces
// the old mismatched treatment (a separately-styled full-width Command
// Center button sitting above a visually unrelated two-column Goal/Roadmap
// toggle row). "Nav" rows just navigate; "toggle" rows show a persistent
// tinted/active state while their panel is open, so the two behaviors read
// as one family instead of unrelated components bolted together.
function SidebarNavRow({ icon: Icon, label, onClick, badgeCount, skinned }: { icon: typeof LayoutGrid; label: string; onClick: () => void; badgeCount?: number; skinned?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-[9px] text-[13px] font-medium transition-colors ${skinned ? 'vera-navrow' : 'rounded-[10px]'}`}
      style={{ color: 'var(--v7-text-dim)', padding: '8px 8px' }}
      {...(skinned
        ? {}
        : {
            onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.color = 'var(--v7-text)'; e.currentTarget.style.background = 'var(--v7-bg-raised-2)'; },
            onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.color = 'var(--v7-text-dim)'; e.currentTarget.style.background = 'transparent'; },
          })}
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

function SidebarToggleRow({ icon: Icon, label, active, onClick, skinned }: { icon: typeof Target; label: string; active: boolean; onClick: () => void; skinned?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-[9px] text-[13px] font-medium transition-colors ${
        skinned ? `vera-navrow${active ? ' vera-navrow-active' : ''}` : 'rounded-[10px]'
      }`}
      style={
        skinned
          ? { padding: '8px 8px', color: active ? undefined : 'var(--v7-text-dim)' }
          : {
              color: active ? 'var(--v7-cyan)' : 'var(--v7-text-dim)',
              background: active ? 'var(--v7-cyan-soft)' : 'transparent',
              padding: '8px 8px',
            }
      }
      {...(skinned
        ? {}
        : {
            onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => { if (!active) e.currentTarget.style.background = 'var(--v7-bg-raised-2)'; },
            onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => { if (!active) e.currentTarget.style.background = 'transparent'; },
          })}
      title={active ? `Hide ${label.toLowerCase()} panel` : `Show ${label.toLowerCase()} panel`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      {active && <span className="w-1.5 h-1.5 rounded-full ml-auto" style={{ background: 'var(--v7-cyan)' }} />}
    </button>
  );
}

// SIX, not five. Five in a two-column grid leaves one tile alone on the last
// row, which reads as a missing card rather than as whitespace — the same
// problem the landing page's monthly-review grid hit and solved the same way
// (see REVIEW_CARDS in pages/landing/Sections.tsx). The sixth is a real
// question, not filler: pricing is the most common thing founders bring and
// was the obvious gap in the original five.
//
// Each also carries its own icon. All five previously drew the identical
// bar-chart glyph, so the icon column conveyed nothing and the set read as
// one repeated button — the icons now say what KIND of question each is
// before the text is read.
const EXAMPLE_PROMPTS: { text: string; Icon: typeof Target }[] = [
  { text: 'Map the causal chain for my business from the most significant market shifts right now', Icon: GitBranch },
  { text: "What's my biggest risk right now and how do I fix it?", Icon: ShieldAlert },
  { text: 'Build me a 6-month roadmap based on similar companies at my stage', Icon: MapIcon },
  { text: 'Find 3 failed companies most similar to mine and why they failed', Icon: TrendingDown },
  { text: 'Run an investor-fit analysis — which VCs are most likely to fund us?', Icon: Landmark },
  { text: "Pressure-test my pricing — where am I leaving money on the table?", Icon: Tag },
];

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

// Both composers were `rows={1}` with a max-height and no auto-grow, so the
// textarea stayed one 38px line no matter how much was typed and scrolled the
// content out of sight. Measured on the deployed build: a 302-character
// question had scrollHeight 125px inside a 38px box — the founder could see
// roughly the last twelve words of what they had written, on the primary
// input of the entire product. Every serious composer (ChatGPT, Claude,
// Linear, Slack) grows to a cap and then scrolls; this does the same.
//
// Height is reset to 'auto' before reading scrollHeight because scrollHeight
// never shrinks below the element's current height — without the reset the
// box would grow but never shrink back when text is deleted.
function useAutoGrow(value: string, maxHeight = 200) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value, maxHeight]);

  return ref;
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
  // Controls whose look is set inline here can't be restyled from CSS, so the
  // skinned variants are swapped in explicitly. Classic keeps every original
  // inline value and imperative handler untouched.
  const { skin } = useVeraSkin();
  const skinned = skin !== 'classic';
  const [sessions, setSessions] = useState<ChatSession[]>(getSessions);
  const [currentSession, setCurrentSession] = useState<ChatSession>(() => {
    const existing = getSessions();
    // A route that isn't this one (Decisions) can ask for a specific chat by
    // leaving its server id behind — see OPEN_CHAT_KEY. Read here rather than
    // in an effect so the correct thread is the first thing painted, instead
    // of the most recent one flashing up and being replaced.
    const pending = takePendingChatId();
    const requested = pending != null ? existing.find((s) => s.serverChatId === pending) : undefined;
    if (requested) return requested;
    return existing.length > 0 ? existing[0] : createSession();
  });
  const [saved, setSaved] = useState(getSavedAnalyses);
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
  // One hook per composer — only one of the two is mounted at a time (empty
  // state vs. active thread), but they are separate elements so each needs
  // its own ref.
  const heroComposerRef = useAutoGrow(input);
  const threadComposerRef = useAutoGrow(input);
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
            evidenceRefs: res.evidenceRefs,
            contradictions: res.contradictions,
            // Both were already on the wire and both were being thrown away
            // here — see IntegrityNotices for why that mattered.
            arithmeticIssues: (res as any).arithmeticIssues,
            lengthConstraintNote: (res as any).lengthConstraintNote,
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

  // Opens a chat by its SERVER id. The command centre's decision follow-ups
  // know which chat they came from as a server chat id, but sessions are
  // keyed locally — `serverChatId` is the join between the two. Returns
  // silently when there's no local session for it (a chat started on another
  // device, or cleared history): navigating to a blank thread would be worse
  // than leaving the founder where they are.
  const handleOpenChatById = (serverChatId: number) => {
    const source = getSessions().find((s) => s.serverChatId === serverChatId);
    if (!source) return;
    setCurrentSession(source);
    setMainView('chat');
  };

  // A refinement rewrites the draft in place and is persisted, so the
  // revised text survives a reload or a switch between chats. Without this
  // the workspace would hold the newest version only in component state and
  // quietly throw away the founder's edits the moment they navigated away.
  const handleDraftRevised = (messageIndex: number, nextText: string) => {
    const updated: ChatSession = {
      ...sessionRef.current,
      messages: sessionRef.current.messages.map((m, i) => (i === messageIndex ? { ...m, content: nextText } : m)),
    };
    setCurrentSession(updated);
    persistSession(updated);
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
              <VeraMark size={14} />
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
            /* Was '/line' — the Nexus feed, which is archived and no longer
               routed, so this button had become a one-way trip to NotFound.
               '/' is now the landing page. */
            onClick={() => navigate('/')}
            className="flex items-center gap-[7px] text-[13px] font-medium transition-colors"
            style={{ color: 'var(--v7-text-mute)', padding: '8px 8px' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--v7-text-dim)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--v7-text-mute)')}
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5"><path d="M15 5L8 12L15 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Back to home
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
        {/* Under a skin this is a filled key that travels under the finger,
            not a tinted panel that glows — it is the most-pressed control in
            the product and previously shared its shape with every quiet nav
            row beneath it. Classic keeps the original tint and glow. */}
        <button
          onClick={handleNewChat}
          className={
            skinned
              ? 'vera-key vera-key-1 vera-newchat mb-[10px]'
              : 'flex items-center gap-[9px] font-bold text-[13.5px] transition-all mb-[10px]'
          }
          style={
            skinned
              ? undefined
              : {
                  background: 'var(--v7-cyan-soft)',
                  border: '1px solid var(--v7-cyan-strong)',
                  color: 'var(--v7-cyan)',
                  padding: '11px 15px',
                  borderRadius: '14px',
                }
          }
          {...(skinned
            ? {}
            : {
                onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'var(--v7-cyan-soft)'; e.currentTarget.style.boxShadow = '0 0 20px -6px var(--v7-cyan-strong)'; },
                onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'var(--v7-cyan-soft)'; e.currentTarget.style.boxShadow = 'none'; },
              })}
        >
          <Plus className="w-3.5 h-3.5" />
          New Analysis
        </button>

        {/* Command Center, Workflows, then the Goal/Roadmap show/hide
            toggles — in that order (see build-plan discussion: nav items
            first, toggles last, room left for future nav items between
            Workflows and Goals). */}
        {/* "Goals" used to appear twice in this sidebar with two different
            meanings — once here as a show/hide toggle for the panel above the
            chat, and again in the bottom group as a link to the full
            cross-chat goals page. Two identical labels, two unrelated
            behaviours, about 400px apart. The toggles now say what they
            actually control (a panel in this view) and sit under their own
            heading; the destinations below are named as destinations. */}
        <div className="mb-[18px]" style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <SidebarNavRow icon={LayoutGrid} label="Command Center" onClick={() => setMainView('command-center')} badgeCount={pendingQueueCount} skinned={skinned} />
          <SidebarNavRow icon={WorkflowIcon} label="Workflows" onClick={() => navigate('/vera/workflows')} skinned={skinned} />
          {/* The slot the sidebar comment above explicitly left open ("room
              left for future nav items between Workflows and Goals"). */}
          <SidebarNavRow icon={Fingerprint} label="Dossier" onClick={() => navigate('/vera/dossier')} skinned={skinned} />
          <div className="vera-label" style={{ padding: '10px 8px 4px' }}>Show above chat</div>
          <SidebarToggleRow icon={Target} label="Goal panel" active={showGoalPanel} onClick={toggleGoalPanel} skinned={skinned} />
          <SidebarToggleRow icon={MapIcon} label="Roadmap panel" active={showRoadmap} onClick={toggleRoadmap} skinned={skinned} />
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

          {/* The saved-analysis list used to live here, under the full chat
              history — so reaching it meant scrolling past every chat the
              founder had ever started. Command Center owns saved work now
              (see its SAVED ANALYSIS line and the book behind it), which is
              a fixed position that doesn't recede as history grows. */}
        </div>

        {/* Bottom Settings */}
        <div style={{ borderTop: '1px solid var(--v7-border)', marginTop: '12px', paddingTop: '14px' }}>
          <button
            onClick={() => navigate('/vera/goals')}
            className="w-full flex items-center gap-[9px] text-[13px] font-medium transition-colors mb-1"
            style={{ color: 'var(--v7-text-dim)', paddingLeft: '8px' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--v7-text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--v7-text-dim)')}
          >
            <Target className="w-3.5 h-3.5" />
            All goals
          </button>
          <button
            onClick={() => navigate('/vera/decisions')}
            className="w-full flex items-center gap-[9px] text-[13px] font-medium transition-colors mb-1"
            style={{ color: 'var(--v7-text-dim)', paddingLeft: '8px' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--v7-text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--v7-text-dim)')}
          >
            <ListChecks className="w-3.5 h-3.5" />
            All decisions
          </button>
          {/* Used to expand an inline panel right here — Connectors plus the
              Appearance list pushed the bottom of this fixed-height,
              non-scrolling sidebar (`h-screen`, no overflow-y-auto) past the
              viewport, with no way back to it short of zooming the whole
              page out. A centered popup isn't laid out inside this column at
              all, so nothing it contains can push anything else off-frame. */}
          <button
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center gap-[9px] text-[13px] font-medium transition-colors"
            style={{ color: 'var(--v7-text-dim)', paddingLeft: '8px' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--v7-text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--v7-text-dim)')}
          >
            <Settings className="w-3.5 h-3.5" />
            Settings
          </button>
        </div>
      </aside>
      <VeraSettingsModal open={showSettings} onClose={() => setShowSettings(false)} theme={theme} />
      </>
      )}

      {/* Main Chat Area — swaps to Command Center in place, same view New
          Chat itself swaps into (see mainView state), never a separate
          route/page. */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* The Living Context bar used to sit here, above both views. It
            printed days-active / streak / decisions / automations / free
            time — the same five figures the Command Center's own rail
            already lists, immediately below it, on the one screen a founder
            actually reads them on. Two copies of one set of numbers, one of
            them permanently occupying the top of the chat view as well.
            Deleted: the rail keeps the figures (with a week strip the bar
            never had), and the connector glyphs the bar alone carried moved
            into the rail's Connected tile. */}
        {mainView === 'command-center' ? (
          <CommandCenterSection
            theme={theme}
            onBack={() => setMainView('chat')}
            onOpenThread={handleOpenSavedThread}
            onContinueInChat={handleContinueFromMiniVera}
            onOpenChatById={handleOpenChatById}
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

            <div className={`m-auto flex flex-col items-center w-full max-w-[600px] relative ${skinned ? 'vera-hero-axis' : ''}`}>
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
                  {/* Was a compass needle, which appeared nowhere else —
                      not on the landing page, not in the launch film. One
                      mark now, from components/VeraMark. */}
                  <VeraMark size={30} />
                </div>
                <span className="font-extrabold" style={{ fontSize: '28px', letterSpacing: '-0.01em', color: 'var(--v7-text)' }}>Vera</span>
              </div>

              <div
                className="text-[12.5px] font-bold uppercase mb-4"
                style={{ fontFamily: 'var(--v7-font-mono)', letterSpacing: '0.04em', color: 'var(--v7-text-mute)' }}
              >
                What brings you here today?
              </div>

              {/* Size and leading come from tokens so each skin can match
                  APPARENT size rather than share one number — 34px of
                  Instrument Serif at 400 reads visibly smaller than 34px of
                  Archivo at 600. Classic's original values are the
                  fallbacks. */}
              <h1 className="font-extrabold mb-[14px]" style={{ fontSize: 'var(--vera-hero-size, 34px)', lineHeight: 'var(--vera-hero-leading, 1.28)', letterSpacing: '-0.01em', color: 'var(--v7-text)' }}>
                The cause behind<br />every{' '}
                {/* Routed through two custom properties so a skin can retire
                    the gradient without this file knowing which skin is
                    active. Both fall back to the original values, so with no
                    skin selected this renders the exact gradient it always
                    did; Alloy and Vessel set --vera-emph-bg to none and take
                    the emphasis from the accent at full strength instead. */}
                <span style={{ background: 'var(--vera-emph-bg, linear-gradient(100deg, var(--v7-cyan), var(--v7-pink)))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'var(--vera-emph-fg, transparent)' }}>
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
                  ref={heroComposerRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder="Tell Vera what's really going on…"
                  rows={1}
                  className="flex-1 bg-transparent border-none outline-none resize-none min-h-[38px] py-2 font-medium text-[14.5px]"
                  style={{ color: 'var(--v7-text)', fontFamily: 'var(--v7-font-round)' }}
                />
                <button
                  type="submit"
                  disabled={(!input.trim() && !pendingAttachment) || analyzeMutation.isPending}
                  className={`w-[38px] h-[38px] shrink-0 flex items-center justify-center transition-all disabled:opacity-40 ${skinned ? 'vera-key vera-key-1' : ''}`}
                  style={{ borderRadius: 'var(--vera-key-r, 12px)', border: 'none', background: 'var(--v7-cyan)', padding: 0 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--v7-bg)" strokeWidth="2.3">
                    <path d="M7 17L17 7M17 7H9M17 7V15" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </form>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-[10px] w-full">
                {EXAMPLE_PROMPTS.map(({ text: prompt, Icon }, i) => (
                  <button
                    key={prompt}
                    onClick={() => handleSend(prompt)}
                    className={`ve-row-in text-left flex items-start gap-3 transition-all group ${skinned ? 'vera-suggest' : ''}`}
                    style={{ background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-border)', borderRadius: 'var(--vera-r-card, 16px)', padding: '16px 17px', animationDelay: `${i * 45}ms` }}
                    {...(skinned
                      ? {}
                      : {
                          // Classic keeps its original imperative hover. Under a skin the
                          // .vera-suggest rules own it instead — writing these straight onto
                          // currentTarget.style would win over the stylesheet and undo it.
                          onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.borderColor = 'var(--v7-cyan-strong)'; e.currentTarget.style.background = 'var(--v7-bg-raised-2)'; e.currentTarget.style.transform = 'translateY(-2px)'; },
                          onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.borderColor = 'var(--v7-border)'; e.currentTarget.style.background = 'var(--v7-bg-raised)'; e.currentTarget.style.transform = 'translateY(0)'; },
                        })}
                  >
                    <div
                      className={`w-[30px] h-[30px] flex items-center justify-center shrink-0 ${skinned ? 'vera-socket' : 'rounded-[10px]'}`}
                      style={skinned ? undefined : { background: 'var(--v7-bg-raised-2)' }}
                    >
                      <Icon className="w-4 h-4" style={{ color: i % 2 === 0 ? 'var(--v7-cyan)' : 'var(--v7-pink)' }} />
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
                      </div>

                      {/* A response that IS the deliverable (a post, an
                          email, a Slack message the founder asked Vera to
                          write) renders as a working document instead of
                          chat prose — copyable, revisable line by line, and
                          publishable where the connector can take it. Every
                          other answer stays exactly as it was. */}
                      {(() => {
                        if (msg.role !== 'venus' || (msg as any).isError || !msg.content) {
                          return msg.content ? <VenusMessage content={msg.content} confidence={msg.confidence} confidenceNote={msg.confidenceNote} /> : null;
                        }
                        const draftChannel = detectDraftChannel(msg.contextQuery, msg.content);
                        if (!draftChannel) {
                          return <VenusMessage content={msg.content} confidence={msg.confidence} confidenceNote={msg.confidenceNote} />;
                        }
                        return (
                          <DraftWorkspace
                            key={i}
                            initialText={msg.content}
                            channel={draftChannel}
                            onTextChange={(next) => handleDraftRevised(i, next)}
                          />
                        );
                      })()}

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
                            <ResponseJumpNav cards={displayCards} messageIndex={i} />
                            <div className="grid grid-cols-1 gap-3 mt-2">
                              {displayCards.map((card: any, ci: number) => (
                                <VenusCard
                                  key={`${ci}-${card.title ?? 'card'}`}
                                  card={card}
                                  index={ci}
                                  messageIndex={i}
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

                      {msg.role === 'venus' && !(msg as any).isError && (
                        <>
                          <IntegrityNotices
                            arithmeticIssues={msg.arithmeticIssues}
                            lengthConstraintNote={msg.lengthConstraintNote}
                          />
                          <EvidenceStrip
                            confidence={msg.confidence}
                            note={msg.confidenceNote}
                            evidenceRefs={msg.evidenceRefs}
                            contradictions={msg.contradictions}
                          />
                        </>
                      )}

                      {/* Response actions: copy, download, save */}
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
                ref={threadComposerRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Ask Vera for unvarnished analysis..."
                rows={1}
                className="flex-1 bg-transparent border-none outline-none resize-none min-h-[44px] py-3 px-4 text-sm text-[var(--text)] placeholder-[var(--dim)]"
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

// The brand mark shrunk to the per-message avatar slot, so every Vera
// response carries the same logo as the sidebar, the hero, the landing page
// and the launch film. One definition — see components/VeraMark.
function VeraAvatar({ pulse = false }: { pulse?: boolean }) {
  return (
    <div
      className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center${pulse ? ' animate-pulse' : ''}`}
      style={{ background: 'var(--v7-bg-raised-2)', border: '1px solid var(--v7-border-strong)' }}
    >
      <VeraMark size={12} />
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
          // Was --mint in mono uppercase — byte-for-byte the same treatment
          // highlightFigures gives inline numbers, so a section heading and a
          // metric inside a sentence were indistinguishable and the accent
          // stopped meaning anything. Headings are structure, not data.
          return <h3 key={i} className="vera-label pt-3 first:pt-0">{line.slice(4)}</h3>;
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

        // A paragraph that is really a list written inline — see
        // parseInlineEnumeration. The lead-in keeps its paragraph; the points
        // become points.
        const enumeration = parseInlineEnumeration(line);
        if (enumeration) {
          return (
            <div key={i} className="space-y-1.5">
              {enumeration.lead && <p>{renderInline(enumeration.lead)}</p>}
              <div className="space-y-1.5 pt-0.5">
                {enumeration.items.map((item, n) => (
                  <div key={n} className="flex items-start gap-2">
                    <span className="text-[var(--dim)] font-mono text-xs shrink-0 pt-0.5">{n + 1}.</span>
                    <span>{renderInline(item)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

/* ---- Inline enumerations ------------------------------------------------
 *
 * THE PROBLEM. VenusMessage only recognises structure that starts a LINE —
 * "- ", "1. ", "### ". But the model routinely enumerates inside a running
 * paragraph instead:
 *
 *   "Right now you could (1) define a concrete experiment … (2) map out the
 *    cost and expected lift … (3) set a short-term metric …"
 *
 * That is three discrete actions, and it rendered as one 60-word block the
 * founder has to parse by eye to find the three things in it. The content was
 * already a list; only the markup was missing.
 *
 * This splits such a paragraph into its lead-in sentence plus its items, so
 * prose stays prose and points become points — without touching paragraphs
 * that are genuinely prose.
 *
 * DELIBERATELY CONSERVATIVE, because a false positive mangles a real
 * sentence. Three conditions must all hold:
 *
 *   - at least two markers, so "(1)" used once as a footnote reference is
 *     left alone;
 *   - numbered exactly 1, 2, 3 … in order, so "(3) and (7)" — a citation
 *     style, not a list — does not match;
 *   - each marker preceded by a space or the line start, so "chapter(2)" and
 *     decimals inside figures are never markers.
 *
 * Only the parenthesised forms "(1)" and "1)" are recognised. A bare "1."
 * mid-sentence is genuinely ambiguous against decimals, version numbers and
 * ordinary sentence-ending digits, and is not worth the risk.
 */
interface InlineEnumeration {
  lead: string;
  items: string[];
}

function parseInlineEnumeration(line: string): InlineEnumeration | null {
  for (const pattern of [/(?:^|\s)\((\d+)\)\s+/g, /(?:^|\s)(\d+)\)\s+/g]) {
    const matches = [...line.matchAll(pattern)];
    if (matches.length < 2) continue;
    if (!matches.every((m, i) => Number(m[1]) === i + 1)) continue;

    const lead = line.slice(0, matches[0].index).trim();
    const items = matches.map((match, i) => {
      const start = match.index + match[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : line.length;
      return line.slice(start, end).trim();
    });

    // An item that is empty or a single stray word is a sign the pattern
    // matched something that wasn't a list after all.
    if (items.some((item) => item.length < 3)) continue;
    return { lead, items };
  }
  return null;
}

// Two fixes over the previous pattern:
//
// 1. The magnitude suffix was `[KMBT]` — uppercase only. Models write "$4.1k"
//    far more often than "$4.1K", so the match ended at "$4.1" and the "k" was
//    left behind as ordinary text: the figure rendered visibly split, half
//    accented and half not, mid-word. Now case-insensitive.
// 2. Bare four-digit years were highlighted as figures. A year is not a
//    metric, and in an analysis full of dates it meant most of the accent on
//    screen was carrying no meaning — the speckled "ransom note" effect. Years
//    inside a real figure (e.g. "2024%") still match the other branches.
const FIGURE_SPLIT_RE = /(\$\d[\d,.]*\s?[kmbtKMBT]?\b|\d[\d,.]*\s?%|\b\d[\d,.]*x\b)/g;
const FIGURE_TEST_RE = /^(\$\d[\d,.]*\s?[kmbtKMBT]?|\d[\d,.]*\s?%|\d[\d,.]*x)$/;

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
          <div key={key} className="vera-block">
            <div className="vera-label mb-1">{key.replace(/_/g, ' ')}</div>
            <div className="text-[13px] text-[var(--text)] leading-relaxed">{renderStructuredValue(entryValue, depth + 1)}</div>
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

// Three states, not two. The backend already distinguishes them — it records
// a ContradictionSignal whenever the precedents grounding an answer disagree
// on outcome — but the old badge collapsed that into the same green
// "Verified precedent" pill it showed for unanimous evidence, and buried the
// caveat in a hover tooltip that occluded the answer text and does not exist
// at all on touch. On the very first real query run against this build, an
// answer grounded in four precedents (three failed, one acquired) was
// labelled VERIFIED. For a product whose whole claim is causal honesty, that
// is the most expensive defect in it: it manufactures confidence the engine
// itself did not have.
function confidenceState(confidence?: 'verified' | 'exploratory', contradictions?: ContradictionEntry[]) {
  if (!confidence) return null;
  if (contradictions && contradictions.length > 0) {
    return { label: 'Split precedent', color: 'var(--amber)', tone: 'warn' as const };
  }
  if (confidence === 'exploratory') {
    // FIX: this used to hardcode "— no precedent match" unconditionally,
    // but "exploratory" only means the STRONG/verified bar wasn't cleared —
    // a moderate-tier match (or the founder's own past decisions) can still
    // be attached and listed right below this badge, which made it flatly
    // contradict its own evidence list ("no precedent match" next to a
    // "3 precedents" chip and named companies). The actual grounding basis
    // is already stated honestly in the `note` text below this badge.
    return { label: 'Exploratory', color: 'var(--amber)', tone: 'warn' as const };
  }
  // WAS 'Verified precedent'. Nothing in the dataset is verified: every one
  // of the 79 rows in data/precedents.json carries verification_status
  // "auto-extracted-unverified", and confidence.ts's verificationBoost is a
  // documented no-op because of it. The word "verified" here referred to the
  // RETRIEVAL tier — how strongly the question matched — and a founder has
  // no way to read it that way. On a product whose entire pitch is causal
  // honesty, a green badge claiming verification we have not done is the one
  // label we cannot ship. "Precedent-backed" says what is actually true: the
  // answer stands on real matched records from the dataset. If human
  // verification ever lands, this is where "Verified" earns its way back.
  return { label: 'Precedent-backed', color: 'var(--mint)', tone: 'ok' as const };
}

// Response-integrity signals the server computes on every answer and, until
// now, no one rendered. checkArithmeticConsistency ships live (see
// arithmeticCheck.ts) and lengthConstraintNote is written whenever a stated
// word/character target could not be met — both were attached to the JSON
// and dropped on the floor by this client. Surfacing them is the whole
// point of computing them: an answer that quietly contains a period
// -multiplier error, or that silently missed the length the founder asked
// for, is exactly what erodes trust in everything else on the page.
function IntegrityNotices({
  arithmeticIssues,
  lengthConstraintNote,
}: {
  arithmeticIssues?: { description: string }[];
  lengthConstraintNote?: string;
}) {
  const hasArithmetic = Array.isArray(arithmeticIssues) && arithmeticIssues.length > 0;
  if (!hasArithmetic && !lengthConstraintNote) return null;

  return (
    <div
      className="vera-block mt-3"
      style={{ padding: '10px 14px', borderColor: 'var(--amber)' }}
      role="note"
    >
      <span className="vera-label" style={{ fontSize: '12px', color: 'var(--amber)' }}>
        Check before you rely on this
      </span>
      <ul className="mt-1.5 space-y-1">
        {hasArithmetic &&
          arithmeticIssues!.map((issue, i) => (
            <li key={`arith-${i}`} style={{ fontSize: '13px' }}>
              Numbers don't reconcile: {issue.description}
            </li>
          ))}
        {lengthConstraintNote && (
          <li key="length" style={{ fontSize: '13px' }}>
            {lengthConstraintNote}
          </li>
        )}
      </ul>
    </div>
  );
}

// The evidence itself, rendered inline and always visible rather than hidden
// behind a hover. Naming the precedents an answer stands on is the single
// thing Vera can show that a general-purpose chat assistant cannot — it was
// being computed on every request and then thrown away by the client.
function EvidenceStrip({
  confidence,
  note,
  evidenceRefs,
  contradictions,
}: {
  confidence?: 'verified' | 'exploratory';
  note?: string;
  evidenceRefs?: EvidenceRefEntry[];
  contradictions?: ContradictionEntry[];
}) {
  const [open, setOpen] = useState(false);
  const state = confidenceState(confidence, contradictions);
  const precedents = (evidenceRefs ?? []).filter((r) => r.type === 'precedent');
  const ownDecisions = (evidenceRefs ?? []).filter((r) => r.type === 'own_decision');
  const conflict = contradictions?.[0]?.description;

  if (!state && precedents.length === 0) return null;

  return (
    <div className="vera-block mt-3" style={{ padding: '12px 14px' }}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {/* FIX: this whole strip was the smallest text on the page (10px,
            same as .vera-label below) despite being the one element meant to
            invite scrutiny of an answer. Bumped to 12px locally via inline
            style rather than raising the shared .vera-label token, which is
            reused across ~30 other spots in the card system that weren't
            part of this review. */}
        {state && (
          <span className="inline-flex items-center gap-1.5 font-mono uppercase tracking-wider" style={{ color: state.color, fontSize: '12px' }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: state.color }} />
            {state.label}
          </span>
        )}
        {precedents.length > 0 && (
          <span className="vera-label" style={{ fontSize: '12px' }}>
            {precedents.length} precedent{precedents.length === 1 ? '' : 's'}
            {ownDecisions.length > 0 ? ` · ${ownDecisions.length} of your past decisions` : ''}
          </span>
        )}
        {(precedents.length > 0 || note) && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="vera-label ml-auto flex items-center gap-1 hover:text-[var(--text)]"
            style={{ fontSize: '12px' }}
            aria-expanded={open}
          >
            {open ? 'Hide basis' : 'Show basis'}
            <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* A recorded disagreement is never hidden behind a disclosure — it is
          the part of the answer most likely to change what the founder does. */}
      {conflict && (
        <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--amber)' }}>
          {conflict}
        </p>
      )}

      {open && (
        <div className="mt-2.5 space-y-2">
          {note && <p className="text-[12.5px] leading-relaxed text-[var(--muted-text)]">{note}</p>}
          {precedents.length > 0 && (
            <div>
              <div className="vera-label mb-1" style={{ fontSize: '12px' }}>Precedents used</div>
              <div className="flex flex-wrap gap-1.5">
                {precedents.map((ref) => (
                  <span
                    key={`${ref.type}-${ref.id}`}
                    className="text-[11px] px-2 py-0.5 rounded-full"
                    style={{ border: '1px solid var(--border2)', color: 'var(--muted-text)' }}
                  >
                    {ref.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {ownDecisions.length > 0 && (
            <div>
              <div className="vera-label mb-1" style={{ fontSize: '12px' }}>Your past decisions</div>
              <ul className="space-y-1">
                {ownDecisions.map((ref) => (
                  <li key={`${ref.type}-${ref.id}`} className="text-[12px] text-[var(--muted-text)] leading-snug">
                    {ref.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResponseJumpNav({ cards, messageIndex }: { cards: any[]; messageIndex: number }) {
  // With one or two cards the "nav" is a row of chips sitting directly above
  // the very headings it links to — the titles rendered twice, a few lines
  // apart, for no navigational gain, and a boxed strip of uppercase mono
  // competing with the card headings themselves. It only earns its space
  // once the stack is genuinely long enough to lose your place in.
  if (cards.length < 4) return null;

  return (
    <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="vera-label">Jump to</span>
      {cards.map((card, index) => (
        <a
          key={index}
          href={`#${cardAnchorId(messageIndex, index)}`}
          className="text-[11px] text-[var(--dim)] underline decoration-dotted underline-offset-[3px] hover:text-[var(--text)] hover:decoration-solid"
        >
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
// Every precedent outcome previously rendered in --mint, the success colour —
// so a company that FAILED was labelled in green, directly contradicting the
// word inside the chip. Outcome is the single most load-bearing field on a
// precedent (it's what makes it a warning or a template), so it gets honest
// semantics: red for failure, green for survival/acquisition, neutral for
// anything the model returns that isn't clearly either.
function OutcomePill({ outcome }: { outcome: unknown }) {
  const raw = String(outcome ?? '').trim();
  if (!raw) return null;
  const negative = /fail|shut|dead|bankrupt|wound|collapse|defunct/i.test(raw);
  const positive = /acquir|ipo|surviv|profitab|scaled|success|active/i.test(raw);
  const color = negative ? 'var(--red)' : positive ? 'var(--mint)' : 'var(--dim)';
  return (
    <span
      className="text-[9.5px] uppercase font-mono px-2 py-0.5 rounded-full tracking-wider shrink-0"
      style={{ color, border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      {raw}
    </span>
  );
}

function PrecedentEntry({ precedent: p, companyReports, onGenerateCompanyReport }:{ precedent: any; companyReports: Record<string, CompanyReportState>; onGenerateCompanyReport: (companyName: string) => Promise<void> }) {
  const [reportExpanded, setReportExpanded] = useState(false);
  const reportKey = p.company ? normalizeCompanyKey(String(p.company)) : null;
  const reportState = reportKey ? companyReports[reportKey] : undefined;

  return (
    <div className="vera-block relative" style={{ boxShadow: 'inset 2px 0 0 0 var(--mint)' }}>
      <div className="flex items-baseline justify-between gap-3 mb-1.5 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-[15px] text-[var(--text)]">{p.company}</span>
          <span className="font-mono text-[11px] text-[var(--dim)]">{p.year}</span>
        </div>
        {p.outcome && <OutcomePill outcome={p.outcome} />}
      </div>
      <div className="vera-label mb-1">Causal lesson</div>
      <p className="text-[13px] text-[var(--muted-text)] leading-relaxed">{renderInline(String(p.lesson ?? ''))}</p>

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
          className="rounded-full border border-[var(--v7-tint-border)] bg-[var(--v7-tint)] px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--indigo)] disabled:cursor-wait disabled:opacity-70"
          disabled={reportState?.status === 'loading'}
        >
          {reportState?.status === 'loading' ? 'Researching…' : reportState?.status === 'ready' ? (reportExpanded ? 'Hide report' : 'Show report') : 'Generate Report'}
        </button>
      </div>

      {reportExpanded && reportState && (
        <div className="vera-block mt-3" style={{ background: 'var(--vera-card-bg)' }}>
          {reportState.status === 'loading' && <div className="text-sm text-[var(--muted-text)]">Gathering public details and sources…</div>}
          {reportState.status === 'error' && <div className="text-sm text-[var(--red)]">{reportState.error ?? 'Report generation failed.'}</div>}
          {reportState.status === 'ready' && reportState.report && (
            <div className="space-y-3">
              <div>
                <div className="vera-label mb-1">Snapshot</div>
                <div className="space-y-1 text-sm text-[var(--muted-text)]">
                  {reportState.report.snapshot.foundedYear && <div>Founded: {renderInline(reportState.report.snapshot.foundedYear)}</div>}
                  {reportState.report.snapshot.founders && reportState.report.snapshot.founders.length > 0 && <div>Founders: {renderInline(reportState.report.snapshot.founders.join(', '))}</div>}
                  {reportState.report.snapshot.fundingRaised && <div>Funding: {renderInline(reportState.report.snapshot.fundingRaised)}</div>}
                  {reportState.report.snapshot.whatTheyBuilt && <div>Built: {renderInline(reportState.report.snapshot.whatTheyBuilt)}</div>}
                </div>
              </div>
              <div>
                <div className="vera-label mb-1">Timeline</div>
                <ul className="space-y-1.5 list-disc pl-5 text-sm text-[var(--muted-text)]">
                  {reportState.report.timeline.map((entry, entryIndex) => (
                    <li key={`${entry.label}-${entryIndex}`}><span className="text-[var(--text)]">{entry.label}</span>: {renderInline(entry.detail)}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="vera-label mb-1">What happened</div>
                <p className="text-sm text-[var(--muted-text)] leading-relaxed">{renderInline(reportState.report.analysis)}</p>
              </div>
              {reportState.report.sources.length > 0 && (
                <div>
                  <div className="vera-label mb-1">Sources</div>
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

// Unrecognized card types used to be coloured from a hard-coded neon list
// (#2ce8d6, #ff7ad1, #f6c945, …). Those are dark-theme values with no light
// equivalent, so in light mode a new card type rendered its title in neon
// cyan on white — around 1.6:1, effectively unreadable — while every KNOWN
// type correctly used a theme token. Hashing into the same token set the
// known types already draw from keeps the "same topic always gets the same
// colour" property that made hashing worthwhile, without a second, untheme-d
// palette that only works on one background.
const CARD_TYPE_FALLBACK = [
  'var(--indigo-light)',
  'var(--mint)',
  'var(--green)',
  'var(--indigo)',
  'var(--amber)',
];

function hashCardType(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function getCardColor(type: string): string {
  const key = (type || '').toLowerCase().trim();
  if (CARD_TYPE_COLORS[key]) return CARD_TYPE_COLORS[key];
  return CARD_TYPE_FALLBACK[hashCardType(key) % CARD_TYPE_FALLBACK.length];
}

// Risk severity used to render as a solid red chip for EVERY value — a "low"
// risk and a "high" risk were the same alarming red, so the one field whose
// entire job is to rank the list by severity carried no information at all.
// Now the three levels are visually ordered: filled red for high, tinted
// amber for medium, quiet outline for low.
function ImpactPill({ impact }: { impact?: unknown }) {
  const raw = String(impact ?? '').trim();
  if (!raw) return null;
  const level = /high|critical|severe/i.test(raw) ? 'high' : /med|moderate/i.test(raw) ? 'medium' : 'low';
  const style =
    level === 'high'
      ? { background: 'var(--red)', color: '#fff', border: '1px solid var(--red)' }
      : level === 'medium'
        ? { background: 'color-mix(in srgb, var(--amber) 14%, transparent)', color: 'var(--amber)', border: '1px solid color-mix(in srgb, var(--amber) 45%, transparent)' }
        : { background: 'transparent', color: 'var(--dim)', border: '1px solid var(--border2)' };
  return (
    <span
      className="shrink-0 text-[9.5px] uppercase font-mono tracking-wider px-2 py-0.5 rounded-full leading-[1.6]"
      style={style}
    >
      {raw}
    </span>
  );
}

// Anchors used to be `venus-card-${index}` where index is the card's position
// WITHIN its message — so every response in a thread emitted its own
// `venus-card-0`, `venus-card-1`, … Duplicate ids are invalid HTML and
// `href="#venus-card-0"` resolves to the FIRST match in the document, so a
// jump chip in the third answer scrolled the founder back to the first
// answer. Scoping the id to the message makes it unique for the whole thread.
function cardAnchorId(messageIndex: number, cardIndex: number): string {
  return `venus-card-${messageIndex}-${cardIndex}`;
}

// One line of a card's own content, for the collapsed state.
function cardPreviewLine(type: string, content: Record<string, any>): string {
  const first = (arr: unknown, pick: (item: Record<string, any>) => unknown) => {
    if (!Array.isArray(arr) || arr.length === 0) return '';
    const item = parseMaybeJson(arr[0]);
    const value = isRecord(item) ? pick(item) : item;
    return value == null ? '' : String(value);
  };
  const text = (() => {
    switch (type) {
      case 'analysis': return first(content.points, (p) => p.label ?? p.value);
      case 'risk': return first(content.risks, (r) => r.name);
      case 'roadmap': return first(content.phases ?? content.milestones, (m) => m.title ?? m.goal ?? m.period);
      case 'precedent': return first(content.precedents, (p) => p.company ? `${p.company} — ${p.lesson ?? ''}` : p.lesson);
      case 'market': return content.whitespace ? String(content.whitespace) : first(content.competitors, (c) => c.name);
      case 'decision': return content.recommendation ? String(content.recommendation) : first(content.options, (o) => o.name);
      case 'funnel': return first(content.stages ?? content.steps, (s) => s.stage_title ?? s.title ?? s.name);
      case 'solution': return first(content.solutions ?? content.options, (s) => s.title ?? s.name);
      default: {
        const firstString = Object.values(content).find((v) => typeof v === 'string' && v.trim());
        return typeof firstString === 'string' ? firstString : '';
      }
    }
  })();
  return text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
}

function VenusCard({ card, index = 0, messageIndex = 0, contextQuery = '', previousContextQuery = '', isPrimary = false, companyReports, onGenerateCompanyReport }:{ card: any; index?: number; messageIndex?: number; contextQuery?: string; previousContextQuery?: string; isPrimary?: boolean; companyReports: Record<string, CompanyReportState>; onGenerateCompanyReport: (companyName: string) => Promise<void> }) {
  // A market card whose query didn't mention market/competitor/TAM keywords
  // used to be DELETED outright (`if (!shouldRenderMarket) return null`).
  // That silently threw away analysis the model produced and the backend
  // paid for, with nothing on screen to say it existed — and because the
  // parent still counted it when building the jump nav, it also left a chip
  // pointing at an anchor that was never rendered. Off-topic supporting
  // material is a reason to start it collapsed, not to destroy it.
  const offTopic = card.type === 'market' && !isMarketQueryRelevant(contextQuery);
  const [expanded, setExpanded] = useState(isPrimary && !offTopic);
  const color = getCardColor(card.type);
  const content = parseMaybeJson(card.content);
  const normalizedContent: Record<string, any> = isRecord(content) ? content : { value: content };
  const changedScopeNote = previousContextQuery && contextQuery && previousContextQuery !== contextQuery ? 'Refined for current scope' : null;
  const primary = Boolean(isPrimary || card.role === 'primary') && !offTopic;
  const anchorId = cardAnchorId(messageIndex, index);
  const previewLine = cardPreviewLine(card.type, normalizedContent);
  const precedentCompany = card.type === 'precedent' ? (typeof normalizedContent.precedents?.[0]?.company === 'string' ? normalizedContent.precedents[0].company : null) : null;
  const companyReportKey = precedentCompany ? normalizeCompanyKey(precedentCompany) : null;
  const companyReportState = companyReportKey ? companyReports[companyReportKey] : undefined;

  const body = (
    <div className="mt-4 space-y-4">
      {/* Was --mint (the success colour) for what is a neutral piece of
          metadata, and shown on the very first answer of a chat where there
          is no previous scope to have been refined from. */}
      {changedScopeNote && !primary && (
        <div className="vera-label">{changedScopeNote}</div>
      )}

      {card.type === 'analysis' && (
        <ul className="space-y-3">
          {(normalizedContent.points ?? []).map((pt: any, i: number) => (
            <li key={i} className="flex flex-col gap-1 pb-3 last:pb-0" style={{ borderBottom: '1px solid var(--vera-inset-border)' }}>
              <span className="vera-label">{pt.label}</span>
              <span className="text-[13px] text-[var(--text)] leading-relaxed">{renderInline(String(pt.value ?? ''))}</span>
            </li>
          ))}
        </ul>
      )}

      {card.type === 'risk' && (
        <div className="space-y-2.5">
          {(normalizedContent.risks ?? []).map((risk: any, i: number) => (
            <div key={i} className="vera-block">
              <div className="flex justify-between items-start gap-3 mb-1.5">
                <span className="text-sm font-semibold text-[var(--text)]">{risk.name}</span>
                <ImpactPill impact={risk.impact} />
              </div>
              <p className="text-[13px] text-[var(--muted-text)] leading-relaxed">{renderInline(String(risk.mitigation ?? ''))}</p>
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
              <div key={i} className="vera-block">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 mb-2">
                  <div className="vera-label shrink-0">{m.period ?? m.phase ?? `Phase ${i + 1}`}</div>
                  {m.title && <div className="text-sm font-semibold text-[var(--text)]">{m.title}</div>}
                </div>
                {summaryLine && <div className="text-[13px] text-[var(--muted-text)] leading-relaxed mb-2">{summaryLine}</div>}
                {m.actions && Array.isArray(m.actions) && m.actions.length > 0 && (
                  <ul className="space-y-1.5 list-disc pl-5 text-[13px] text-[var(--text)] mt-2 marker:text-[var(--dim)]">
                    {m.actions.map((action: unknown, actionIndex: number) => {
                      const parsedAction = parseMaybeJson(action);
                      const text = typeof parsedAction === 'string' ? parsedAction : isRecord(parsedAction) ? (parsedAction.text ?? parsedAction.action ?? JSON.stringify(parsedAction)) : String(action);
                      return <li key={actionIndex}>{renderInline(String(text))}</li>;
                    })}
                  </ul>
                )}
                {metricValue && (
                  <div className="mt-2.5 pt-2.5 flex items-baseline gap-2" style={{ borderTop: '1px solid var(--vera-inset-border)' }}>
                    <span className="vera-label shrink-0">Metric</span>
                    <span className="text-[12px] text-[var(--text)]">{renderInline(metricValue)}</span>
                  </div>
                )}
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
              <div key={label} className="vera-block">
                <div className="vera-label mb-1">{label}</div>
                <div className="text-sm text-[var(--text)] font-mono">{String(value)}</div>
              </div>
            ))}
          </div>
          {normalizedContent.competitors != null && (
            <div>
              <div className="vera-label mb-2">Competitors</div>
              <CompetitorList competitors={normalizedContent.competitors} />
            </div>
          )}
          {normalizedContent.whitespace && (
            <div>
              <div className="vera-label mb-2">Whitespace</div>
              <div className="text-[13px] text-[var(--muted-text)] leading-relaxed">{renderInline(String(normalizedContent.whitespace))}</div>
            </div>
          )}
        </div>
      )}

      {card.type === 'decision' && (
        <div className="space-y-3">
          {normalizedContent.recommendation && (
            <div className="vera-block" style={{ background: 'var(--v7-tint)', borderColor: 'var(--v7-tint-border)' }}>
              <div className="vera-label mb-1">Recommendation</div>
              <div className="text-[13px] text-[var(--text)] leading-relaxed">{renderInline(String(normalizedContent.recommendation))}</div>
            </div>
          )}
          {(normalizedContent.options ?? []).map((option: any, i: number) => {
            // "reasoning" is the current schema field (prose, primary content);
            // "verdict" is kept as a fallback for any response still on the
            // older one-line schema so existing/cached responses still render.
            const reasoningText = option.reasoning ?? option.verdict;
            return (
              <div
                key={i}
                className="vera-block"
                style={option.chosen === true ? { borderColor: 'var(--v7-tint-border)', boxShadow: 'inset 2px 0 0 0 var(--indigo)' } : undefined}
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <div className="text-sm font-semibold text-[var(--text)]">{option.name ?? `Option ${i + 1}`}</div>
                  {option.chosen === true && (
                    <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--indigo)] rounded-full border border-[var(--v7-tint-border)] bg-[var(--v7-tint)] px-2 py-0.5">Recommended</span>
                  )}
                </div>
                {reasoningText && (
                  <div className="text-[13px] text-[var(--muted-text)] leading-relaxed">{renderInline(String(reasoningText))}</div>
                )}
                {option.scores && isRecord(option.scores) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 pt-2.5" style={{ borderTop: '1px solid var(--vera-inset-border)' }}>
                    {Object.entries(option.scores).map(([scoreKey, scoreValue]) => (
                      <div key={scoreKey} className="flex items-baseline gap-1.5">
                        <span className="vera-label">{scoreKey.replace(/_/g, ' ')}</span>
                        <span className="text-xs font-mono text-[var(--text)]">{String(scoreValue)}</span>
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
            <div key={stageIndex} className="vera-block">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--v7-tint)] border border-[var(--v7-tint-border)] text-[10px] font-mono text-[var(--indigo)]">{stageIndex + 1}</div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--text)]">{renderInline(String(stage.stage_title ?? stage.title ?? stage.name ?? 'Stage'))}</div>
                  <div className="mt-1 text-[13px] text-[var(--muted-text)] leading-relaxed">{renderInline(String(stage.stage_detail ?? stage.detail ?? stage.description ?? ''))}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {card.type === 'solution' && (
        <div className="space-y-2">
          {(normalizedContent.solutions ?? normalizedContent.options ?? []).map((solution: any, solutionIndex: number) => (
            <div key={solutionIndex} className="vera-block">
              <div className="text-sm font-semibold text-[var(--text)]">{renderInline(String(solution.stage_title ?? solution.title ?? solution.name ?? 'Solution'))}</div>
              <div className="mt-1 text-[13px] text-[var(--muted-text)] leading-relaxed">{renderInline(String(solution.stage_detail ?? solution.detail ?? solution.description ?? ''))}</div>
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

  const heading = (
    <div className="flex items-start justify-between gap-3 text-left">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full shrink-0 translate-y-[-2px]" style={{ background: color }} />
        <h4 className="text-[11px] font-mono uppercase tracking-[0.07em] leading-[1.5]" style={{ color }}>
          {card.title?.trim() || `Section ${index + 1}`}
        </h4>
      </div>
      {primary ? (
        <span className="vera-label shrink-0">Primary answer</span>
      ) : (
        <span className="vera-label shrink-0 flex items-center gap-1">
          {expanded ? 'Hide' : 'Show'}
          <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </span>
      )}
    </div>
  );

  return (
    <div id={anchorId} className="vera-card overflow-hidden" style={primary ? { borderColor: 'var(--v7-tint-border)', boxShadow: 'inset 0 0 0 1px var(--v7-tint)' } : undefined}>
      {primary ? (
        <div>
          {heading}
          {body}
        </div>
      ) : (
        <>
          <button type="button" onClick={() => setExpanded(v => !v)} className="w-full" aria-expanded={expanded}>
            {heading}
          </button>
          {/* A collapsed card used to show its title and nothing else, so with
              eight of them a founder had to open every one to find out which
              was worth reading. One line of the card's own content costs
              nothing and turns the stack into something scannable. */}
          {!expanded && previewLine && (
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--dim)] line-clamp-2 text-left">{previewLine}</p>
          )}
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
    'flex items-center gap-1.5 text-[11px] text-[var(--dim)] hover:text-[var(--text)] hover:border-[var(--border2)] transition-colors border border-transparent px-2 py-1 rounded-md';

  // These were `opacity-0 group-hover:opacity-100` — the only way to copy,
  // export or save an answer was to know it appeared on hover, which means it
  // did not exist at all on a touch device and was undiscoverable on desktop.
  // Saving an analysis is a core loop of this product (Command Center is built
  // around the saved library), so its entry point is now permanently visible,
  // just quiet until you reach for it.
  return (
    <div className="flex items-center gap-1 pt-1 -ml-2">
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