import { useRef, useState, type CSSProperties } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Flame } from 'lucide-react';
import {
  useQueue, useQueueAction, useDailyBrief, useRunInstantAction,
  type QueueItem, type InstantActionType, type DailyBriefStats,
} from '../lib/venusApi';
import type { VenusTheme } from '../lib/venusTheme';

// "OS" — the operational home Vera opens INTO the same view New Chat opens
// into (see Venus.tsx's mainView state), never a separate route/page. The
// visual language here is deliberately its own thing, not the rest of
// Venus's cyan/indigo chat chrome — a warm, paper/notebook aesthetic (per
// the founder's own mockup) so this reads as "the durable record of what
// Vera's been doing," distinct from the ephemeral chat thread. Renamed
// Blackboard (dark)/Whiteboard (light) rather than "notebook" — still one
// physical object, just the surface founders actually write status updates
// on, which is closer to what this page is.
const DARK = {
  bg: '#0a0d12', paper: '#11151d', paperEdge: '#1c212c', line: 'rgba(255,255,255,0.07)',
  text: '#e7e9ee', muted: '#7c8494', faint: '#4b5261',
  teal: '#33d2ac', tealDim: 'rgba(51,210,172,0.14)', tealBorder: 'rgba(51,210,172,0.3)',
  coral: '#d97a63', coralDim: 'rgba(217,122,99,0.14)', coralBorder: 'rgba(217,122,99,0.3)',
  marginRule: 'rgba(217,122,99,0.35)', dogear: '#0a0d12',
};
// `faint` carries the timestamp/source line on every row and was #a89d84 on
// #fffdf7 — 2.64:1 measured, less than half the AA floor, so the one piece
// of text saying WHERE an item came from was the hardest thing on the board
// to read. Now 4.55:1, with `muted` at 7.02:1. Matches the contrast pass in
// index.css's .v7-light.
const LIGHT = {
  bg: '#efe9dc', paper: '#fffdf7', paperEdge: '#ddd3bb', line: 'rgba(25,20,10,0.12)',
  text: '#1c1913', muted: '#5f5747', faint: '#7d7460',
  teal: '#0b7a61', tealDim: 'rgba(11,122,97,0.14)', tealBorder: 'rgba(11,122,97,0.38)',
  coral: '#8f4325', coralDim: 'rgba(143,67,37,0.12)', coralBorder: 'rgba(143,67,37,0.34)',
  marginRule: 'rgba(143,67,37,0.38)', dogear: '#efe9dc',
};

type Palette = typeof DARK;

const SOURCE_LABEL: Record<string, string> = {
  gmail: 'GMAIL', slack: 'SLACK', sheets: 'SHEETS', calendar: 'CALENDAR', notion: 'NOTION',
  jira: 'JIRA', linkedin: 'LINKEDIN', whatsapp: 'WHATSAPP', instant_action: 'QUICK ACTION',
};

function sourceLabel(source: string): string {
  if (source.startsWith('workflow:')) return source.slice('workflow:'.length).replace(/-/g, ' ').toUpperCase();
  return SOURCE_LABEL[source] ?? source.toUpperCase();
}

type Category = 'drafts' | 'decisions' | 'workflows' | 'notes';

function categorize(item: QueueItem): Category {
  if (item.type === 'decision_followup') return 'decisions';
  if (item.type === 'automation_suggestion' || item.type === 'goal_risk') return 'workflows';
  if (item.draftContent) return 'drafts';
  return 'notes';
}

type CategoryMeta = {
  label: string;
  acceptLabel: string;
  rejectLabel: string;
  // Past-tense forms shown on an already-resolved row. Spelled out rather
  // than derived from the verbs above, which would produce "SET UPED".
  acceptedLabel: string;
  editedLabel: string;
  rejectedLabel: string;
};

const CATEGORY_META: Record<Category, CategoryMeta> = {
  drafts: { label: 'DRAFTS', acceptLabel: 'Accept', rejectLabel: 'Dismiss', acceptedLabel: 'ACCEPTED', editedLabel: 'EDITED & SENT', rejectedLabel: 'DISMISSED' },
  decisions: { label: 'DECISIONS', acceptLabel: 'Log outcome', rejectLabel: 'Snooze', acceptedLabel: 'OUTCOME LOGGED', editedLabel: 'OUTCOME LOGGED', rejectedLabel: 'SNOOZED' },
  workflows: { label: 'WORKFLOWS', acceptLabel: 'Set up', rejectLabel: 'Dismiss', acceptedLabel: 'SET UP', editedLabel: 'SET UP', rejectedLabel: 'DISMISSED' },
  notes: { label: 'NOTES', acceptLabel: 'Acknowledge', rejectLabel: 'Dismiss', acceptedLabel: 'ACKNOWLEDGED', editedLabel: 'ACKNOWLEDGED', rejectedLabel: 'DISMISSED' },
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function Entry({ item, palette, category, fresh }: { item: QueueItem; palette: Palette; category: Category; fresh?: boolean }) {
  const action = useQueueAction();
  const [, navigate] = useLocation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.draftContent ?? '');
  const isDone = item.status !== 'pending';
  const meta = CATEGORY_META[category];
  const isFlagged = item.type === 'schedule_alert' || item.type === 'goal_risk';
  const resolution = resolutionFor(item);

  // An item that exists because something isn't set up yet was previously
  // "resolved" by ticking it off, which cleared the row and left the actual
  // problem exactly where it was — the board told you to connect Slack, you
  // pressed the only affirmative button, and Slack stayed unconnected. When
  // an item has somewhere to go, the primary action goes there first and
  // only marks the row resolved once the founder is on the page that can
  // actually fix it.
  const handleResolve = () => {
    if (resolution) {
      action.mutate({ id: item.id, action: 'accept' });
      navigate(resolution.href);
      return;
    }
    action.mutate({ id: item.id, action: 'accept' });
  };

  const handleAccept = () => action.mutate({ id: item.id, action: 'accept' });
  const handleReject = () => action.mutate({ id: item.id, action: 'reject' });
  const handleSubmitEdit = () => {
    if (!draft.trim()) return;
    action.mutate({ id: item.id, action: 'edit', editedContent: draft.trim() }, { onSuccess: () => setEditing(false) });
  };

  return (
    <div
      style={{
        padding: '14px 0',
        borderBottom: fresh ? 'none' : `1px solid ${palette.line}`,
        display: 'flex',
        gap: '12px',
        background: fresh ? palette.tealDim : 'transparent',
        margin: fresh ? '0 -12px 8px' : undefined,
        borderRadius: fresh ? '8px' : undefined,
        transition: 'background 1.2s ease',
      }}
    >
      <span style={{ color: isFlagged ? palette.coral : palette.teal, fontSize: '15px', lineHeight: 1.5 }}>·</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', letterSpacing: '0.04em', color: isFlagged ? palette.coral : palette.faint, margin: '0 0 4px' }}>
          {sourceLabel(item.source)} · {item.createdAt ? formatTime(item.createdAt) : ''}
          {/* A resolved item was previously only struck through, which made
              "I actioned this" and "I dismissed this" look identical the
              next morning. Say which one it was. */}
          {isDone && ` · ${resolutionLabel(item.status, meta)}`}
        </p>
        <p style={{ fontSize: '14.5px', lineHeight: 1.55, margin: '0 0 8px', color: isDone ? palette.faint : palette.text, textDecoration: isDone ? 'line-through' : 'none' }}>
          {item.title}{item.body && item.body !== item.title ? ` — ${item.body}` : ''}
        </p>

        {!isDone && item.draftContent && !editing && (
          <div style={{ fontSize: '12.5px', whiteSpace: 'pre-wrap', color: palette.muted, background: palette.paperEdge, borderRadius: '6px', padding: '8px 10px', marginBottom: '8px' }}>
            {item.draftContent}
          </div>
        )}
        {!isDone && editing && (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            style={{ width: '100%', fontSize: '12.5px', color: palette.text, background: palette.paperEdge, border: `1px solid ${palette.tealBorder}`, borderRadius: '6px', padding: '8px 10px', marginBottom: '8px', outline: 'none', fontFamily: 'inherit' }}
          />
        )}

        {!isDone && (
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            {editing ? (
              <>
                <button type="button" onClick={handleSubmitEdit} style={linkStyle(palette, false)}>Save</button>
                <button type="button" onClick={() => setEditing(false)} style={linkStyle(palette, true)}>Cancel</button>
              </>
            ) : (
              <>
                <button type="button" onClick={resolution ? handleResolve : handleAccept} style={linkStyle(palette, false, isFlagged)}>
                  {resolution ? resolution.label : meta.acceptLabel}
                </button>
                {item.draftContent && <button type="button" onClick={() => setEditing(true)} style={linkStyle(palette, true)}>Edit</button>}
                <button type="button" onClick={handleReject} style={linkStyle(palette, true)}>{meta.rejectLabel}</button>
              </>
            )}
          </div>
        )}
        {action.isError && (
          <div style={{ fontSize: '11px', marginTop: '6px', color: palette.coral }}>
            {action.error instanceof Error ? action.error.message : 'Failed — try again.'}
          </div>
        )}
      </div>
    </div>
  );
}

// The streak used to be a 10.5px sticker rotated 3° into the top-right
// corner, and the counters under it were 10px mono labels — small enough
// that the one surface meant to build a daily habit was the easiest thing
// on the page to miss entirely. This gives the streak the top line, at a
// size that registers, and says something addressed to the founder rather
// than printing a bare number.
function streakLine(streak: number): { headline: string; sub: string } {
  if (streak <= 0) return { headline: 'Day one', sub: 'Clear something off the board and the streak starts today.' };
  if (streak === 1) return { headline: '1 day in a row', sub: 'One day is a start. Come back tomorrow and it becomes a habit.' };
  if (streak < 5) return { headline: `${streak} days in a row`, sub: "You've shown up every day this week. Vera's been keeping up." };
  if (streak < 14) return { headline: `${streak} days in a row`, sub: 'This is a routine now, not a novelty.' };
  return { headline: `${streak} days in a row`, sub: "Genuinely impressive. Vera works better the longer you've done this." };
}

// "Time saved" was a number in minutes — 8m, 24m — which reads as a
// rounding error and quietly invites the founder to check the maths on a
// figure nobody can verify. Free time is the same idea told as a joke: the
// number goes up honestly with automations, but the framing never asks to
// be taken literally, and once you're past a handful of automations it just
// gives up and says infinity.
function freeTimeLabel(minutes: number): string {
  if (minutes <= 0) return '—';
  if (minutes >= 240) return '∞';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function StreakBand({ palette, stats, streak }: { palette: Palette; stats: DailyBriefStats; streak: number }) {
  const { headline, sub } = streakLine(streak);
  const counters = [
    stats.decisionsCaptured > 0 && [String(stats.decisionsCaptured), stats.decisionsCaptured === 1 ? 'decision captured' : 'decisions captured'],
    stats.lessonsLearned > 0 && [String(stats.lessonsLearned), stats.lessonsLearned === 1 ? 'lesson learned' : 'lessons learned'],
    stats.automationsCompleted > 0 && [String(stats.automationsCompleted), stats.automationsCompleted === 1 ? 'automation run' : 'automations run'],
    stats.timeSavedMinutes > 0 && [freeTimeLabel(stats.timeSavedMinutes), 'free time earned'],
  ].filter((x): x is [string, string] => !!x);

  return (
    <div
      style={{
        marginBottom: '26px',
        padding: '18px 20px',
        borderRadius: '10px',
        background: palette.tealDim,
        border: `1px solid ${palette.tealBorder}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: counters.length ? '14px' : 0 }}>
        <Flame style={{ width: 20, height: 20, color: palette.teal, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: '19px', fontWeight: 600, color: palette.text, margin: 0, lineHeight: 1.25 }}>{headline}</p>
          <p style={{ fontSize: '13px', fontStyle: 'italic', color: palette.muted, margin: '2px 0 0', lineHeight: 1.4 }}>{sub}</p>
        </div>
      </div>

      {counters.length > 0 && (
        <div style={{ display: 'flex', gap: '26px', flexWrap: 'wrap', paddingTop: '14px', borderTop: `1px solid ${palette.tealBorder}` }}>
          {counters.map(([value, label]) => (
            <span key={label} style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '20px', fontWeight: 600, color: palette.teal, lineHeight: 1.1 }}>{value}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', color: palette.muted, letterSpacing: '0.03em' }}>{label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Where a queue item's primary action should actually take the founder.
// Derived from the item rather than stored on it, so no schema change is
// needed and older rows written before this existed still route correctly.
// Returns null for items whose resolution genuinely is just "I've seen
// this" (a plain insight, a read alert) — those keep the old tick-off.
function resolutionFor(item: QueueItem): { label: string; href: string } | null {
  if (item.type === 'welcome') return { label: 'Set up workflows', href: '/venus/workflows' };
  if (item.type === 'automation_suggestion') return { label: 'Set up workflow', href: '/venus/workflows' };
  if (item.type === 'goal_risk') return { label: 'Review goal', href: '/venus/goals' };
  if (item.type === 'decision_followup') return { label: 'Log outcome', href: '/venus/decisions' };

  // "Reconnect Slack"-shaped items: the fix lives on the Workflows page,
  // which is where every connector is actually linked from.
  if (item.type === 'connector_error' || item.type === 'connector_setup') {
    return { label: 'Fix connection', href: '/venus/workflows' };
  }

  return null;
}

// Past-tense echo of whichever verb the founder actually pressed, so the
// resolved row says what happened rather than just looking crossed out.
function resolutionLabel(status: string, meta: CategoryMeta): string {
  if (status === 'accepted') return meta.acceptedLabel;
  if (status === 'edited') return meta.editedLabel;
  if (status === 'rejected') return meta.rejectedLabel;
  return status.toUpperCase();
}

function linkStyle(palette: Palette, quiet: boolean, flagged?: boolean): CSSProperties {
  return {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '10.5px',
    letterSpacing: '0.02em',
    color: quiet ? palette.muted : flagged ? palette.coral : palette.teal,
    textDecoration: 'none',
    // These controls are <button>s (they were <a>s with no href, so keyboard
    // users could neither Tab to them nor press Enter). Strip the UA button
    // chrome so they keep reading as the quiet inline links they were.
    background: 'transparent',
    border: 'none',
    padding: 0,
    borderBottom: quiet ? '1px solid transparent' : `1px solid ${flagged ? palette.coralBorder : palette.tealBorder}`,
    cursor: 'pointer',
  };
}

const QUICK_ACTIONS: { type: InstantActionType; label: string; placeholder: string }[] = [
  { type: 'draft_reply', label: 'Draft a reply', placeholder: 'Paste the message you got…' },
  { type: 'sell_this', label: 'Sell this', placeholder: 'Describe what you’re selling…' },
  { type: 'summarize', label: 'Summarize', placeholder: 'Paste the text to summarize…' },
  { type: 'follow_up', label: 'Follow up', placeholder: 'Who/what is this following up on…' },
];

function QuickAddRow({ palette, onAdded }: { palette: Palette; onAdded: (itemId: number) => void }) {
  const [active, setActive] = useState<InstantActionType | null>(null);
  const [input, setInput] = useState('');
  const run = useRunInstantAction();
  const activeMeta = QUICK_ACTIONS.find((a) => a.type === active);

  const submit = () => {
    if (!active || !input.trim()) return;
    run.mutate(
      { type: active, input: input.trim(), mode: 'queue' },
      { onSuccess: (data) => { setActive(null); setInput(''); if (data.item) onAdded(data.item.id); } },
    );
  };

  return (
    <div style={{ marginBottom: '30px', paddingBottom: '20px', borderBottom: `1px solid ${palette.line}` }}>
      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.type}
            onClick={() => setActive(a.type)}
            style={{
              background: 'none', border: 'none', color: palette.teal, fontFamily: "'Fraunces', serif",
              fontSize: '13.5px', fontStyle: 'italic', borderBottom: `1px solid ${palette.tealBorder}`, padding: '0 0 2px', cursor: 'pointer',
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
      {activeMeta && (
        <div style={{ marginTop: '14px' }}>
          <textarea
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={activeMeta.placeholder}
            rows={3}
            style={{ width: '100%', fontSize: '13px', color: palette.text, background: palette.paperEdge, border: `1px solid ${palette.line}`, borderRadius: '6px', padding: '8px 10px', marginBottom: '8px', outline: 'none', fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <a onClick={submit} style={linkStyle(palette, false)}>{run.isPending ? 'Working…' : 'Add to Blackboard'}</a>
            <a onClick={() => { setActive(null); setInput(''); }} style={linkStyle(palette, true)}>Cancel</a>
          </div>
          {run.isError && <div style={{ fontSize: '11px', marginTop: '6px', color: palette.coral }}>{run.error instanceof Error ? run.error.message : 'Failed — try again.'}</div>}
        </div>
      )}
    </div>
  );
}

export function CommandCenterSection({ theme, onBack }: { theme: VenusTheme; onBack: () => void }) {
  const palette = theme === 'light' ? LIGHT : DARK;
  const { data, isLoading } = useQueue();
  const dailyBrief = useDailyBrief();
  const [recentlyAdded, setRecentlyAdded] = useState<Set<number>>(new Set());
  const sectionRefs = useRef<Record<Category, HTMLDivElement | null>>({ drafts: null, decisions: null, workflows: null, notes: null });

  const items = data?.items ?? [];
  const grouped: Record<Category, QueueItem[]> = { drafts: [], decisions: [], workflows: [], notes: [] };
  for (const item of items) grouped[categorize(item)].push(item);

  const streak = dailyBrief.data?.stats.queueStreakDays ?? 0;
  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const boardName = theme === 'light' ? 'Whiteboard' : 'Blackboard';

  // overflowY below is load-bearing: Venus.tsx mounts this inside a
  // `flex-1 flex flex-col overflow-hidden` column, so without its own scroll
  // context everything past the fold was simply clipped and unreachable —
  // the board could not be scrolled at all once it held more than a
  // screenful.
  return (
    <div
      style={{ background: palette.bg, minHeight: '100%', flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '48px 20px 80px', fontFamily: "'Fraunces', serif", color: palette.text }}
    >
      <div style={{ width: '100%', maxWidth: '640px' }}>
        <a onClick={onBack} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: palette.muted, textDecoration: 'none', letterSpacing: '0.02em', display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '28px', cursor: 'pointer' }}>
          <ArrowLeft style={{ width: 12, height: 12 }} /> Back to chat
        </a>

        <div style={{ background: palette.paper, border: `1px solid ${palette.paperEdge}`, borderRadius: '4px 14px 14px 4px', padding: '34px 40px 40px 52px', position: 'relative', boxShadow: '0 30px 60px -30px rgba(0,0,0,0.6)', overflow: 'hidden' }}>
          {/* margin rule — the vertical notebook-page line */}
          <div style={{ position: 'absolute', left: 34, top: 0, bottom: 0, width: 1, background: palette.marginRule }} />
          {/* dog-ear */}
          <div style={{ position: 'absolute', top: 0, right: 0, width: 0, height: 0, borderStyle: 'solid', borderWidth: '0 34px 34px 0', borderColor: `transparent ${palette.dogear} transparent transparent` }} />

          <p style={{ fontStyle: 'italic', fontSize: '13px', color: palette.muted, margin: '0 0 4px' }}>{dateLabel}</p>
          <h1 style={{ fontSize: '28px', fontWeight: 500, margin: '0 0 6px' }}>Today's {boardName}</h1>
          <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11.5px', color: palette.muted, letterSpacing: '0.01em', margin: '0 0 22px' }}>
            EVERYTHING VERA DRAFTED, DECIDED, OR FOUND WHILE YOU WERE AWAY
          </p>

          {/* The retention hook from the build plan (section 7) — plain
              accumulating counts, never a percentage, so this reads as an
              operating history being built rather than a profile to finish.
              Lives here, not buried in a settings page, since this is the
              one screen a founder is meant to open every day. */}
          {dailyBrief.data?.stats && (
            <StreakBand palette={palette} stats={dailyBrief.data.stats} streak={streak} />
          )}

          <div style={{ display: 'flex', gap: '4px', marginBottom: '26px', flexWrap: 'wrap' }}>
            {/* Only categories that actually render a section below get a
                jump chip. The sections themselves are skipped when empty
                (see the `grouped[cat].length === 0 ? null` render further
                down), so a chip for an empty category pointed at a ref that
                was never attached and its click silently did nothing. */}
            {(Object.keys(CATEGORY_META) as Category[]).filter((cat) => grouped[cat].length > 0).map((cat) => (
              <button
                key={cat}
                onClick={() => sectionRefs.current[cat]?.scrollIntoView({ behavior: 'smooth' })}
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', letterSpacing: '0.04em', color: palette.muted, background: 'transparent', border: `1px solid ${palette.paperEdge}`, padding: '6px 11px', borderRadius: '20px', cursor: 'pointer' }}
              >
                {CATEGORY_META[cat].label}
                {grouped[cat].filter((i) => i.status === 'pending').length > 0 && ` (${grouped[cat].filter((i) => i.status === 'pending').length})`}
              </button>
            ))}
          </div>

          <QuickAddRow
            palette={palette}
            onAdded={(itemId) => {
              setRecentlyAdded((prev) => new Set(prev).add(itemId));
              setTimeout(() => setRecentlyAdded((prev) => { const next = new Set(prev); next.delete(itemId); return next; }), 4000);
            }}
          />

          {isLoading && <div style={{ fontSize: '13px', color: palette.muted }}>Loading…</div>}

          {!isLoading && items.length === 0 && (
            <div style={{ fontSize: '13.5px', color: palette.muted, fontStyle: 'italic' }}>
              Nothing on the {boardName.toLowerCase()} yet — it fills up as Vera drafts, decides, and finds things for you.
            </div>
          )}

          {(Object.keys(CATEGORY_META) as Category[]).map((cat) =>
            grouped[cat].length === 0 ? null : (
              <div key={cat} ref={(el) => { sectionRefs.current[cat] = el; }} style={{ marginBottom: '8px' }}>
                <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', letterSpacing: '0.1em', color: palette.faint, margin: '22px 0 4px' }}>
                  {CATEGORY_META[cat].label}
                </p>
                {grouped[cat].map((item) => (
                  <Entry key={item.id} item={item} palette={palette} category={cat} fresh={recentlyAdded.has(item.id)} />
                ))}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
