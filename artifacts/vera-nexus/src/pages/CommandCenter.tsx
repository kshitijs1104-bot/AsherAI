import { useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, Flame } from 'lucide-react';
import {
  useQueue, useQueueAction, useDailyBrief, useRunInstantAction,
  type QueueItem, type InstantActionType,
} from '../lib/venusApi';
import type { VenusTheme } from '../lib/venusTheme';
import { formatMinutes } from './TodayCard';

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
const LIGHT = {
  bg: '#f2ede2', paper: '#fffdf7', paperEdge: '#e3dac6', line: 'rgba(25,20,10,0.08)',
  text: '#242019', muted: '#786f5c', faint: '#a89d84',
  teal: '#0e8f72', tealDim: 'rgba(14,143,114,0.12)', tealBorder: 'rgba(14,143,114,0.3)',
  coral: '#a5502e', coralDim: 'rgba(165,80,46,0.1)', coralBorder: 'rgba(165,80,46,0.28)',
  marginRule: 'rgba(165,80,46,0.32)', dogear: '#f2ede2',
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

const CATEGORY_META: Record<Category, { label: string; acceptLabel: string; rejectLabel: string }> = {
  drafts: { label: 'DRAFTS', acceptLabel: 'Accept', rejectLabel: 'Dismiss' },
  decisions: { label: 'DECISIONS', acceptLabel: 'Log outcome', rejectLabel: 'Snooze' },
  workflows: { label: 'WORKFLOWS', acceptLabel: 'Set up', rejectLabel: 'Dismiss' },
  notes: { label: 'NOTES', acceptLabel: 'Acknowledge', rejectLabel: 'Dismiss' },
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function Entry({ item, palette, category, fresh }: { item: QueueItem; palette: Palette; category: Category; fresh?: boolean }) {
  const action = useQueueAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.draftContent ?? '');
  const isDone = item.status !== 'pending';
  const meta = CATEGORY_META[category];
  const isFlagged = item.type === 'schedule_alert' || item.type === 'goal_risk';

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
                <a onClick={handleSubmitEdit} style={linkStyle(palette, false)}>Save</a>
                <a onClick={() => setEditing(false)} style={linkStyle(palette, true)}>Cancel</a>
              </>
            ) : (
              <>
                <a onClick={handleAccept} style={linkStyle(palette, false, isFlagged)}>{meta.acceptLabel}</a>
                {item.draftContent && <a onClick={() => setEditing(true)} style={linkStyle(palette, true)}>Edit</a>}
                <a onClick={handleReject} style={linkStyle(palette, true)}>{meta.rejectLabel}</a>
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

function linkStyle(palette: Palette, quiet: boolean, flagged?: boolean): CSSProperties {
  return {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '10.5px',
    letterSpacing: '0.02em',
    color: quiet ? palette.muted : flagged ? palette.coral : palette.teal,
    textDecoration: 'none',
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

  return (
    <div
      style={{ background: palette.bg, minHeight: '100%', flex: 1, display: 'flex', justifyContent: 'center', padding: '48px 20px 80px', fontFamily: "'Fraunces', serif", color: palette.text }}
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

          {streak > 0 && (
            <div style={{ position: 'absolute', top: 36, right: -6, transform: 'rotate(3deg)', background: palette.tealDim, border: `1px solid ${palette.tealBorder}`, color: palette.teal, fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', letterSpacing: '0.03em', padding: '5px 10px 5px 8px', borderRadius: '3px', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Flame style={{ width: 13, height: 13 }} /> {streak}-day streak
            </div>
          )}

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
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '22px', paddingBottom: '18px', borderBottom: `1px solid ${palette.line}` }}>
              {[
                dailyBrief.data.stats.decisionsCaptured > 0 && [String(dailyBrief.data.stats.decisionsCaptured), dailyBrief.data.stats.decisionsCaptured === 1 ? 'decision captured' : 'decisions captured'],
                dailyBrief.data.stats.lessonsLearned > 0 && [String(dailyBrief.data.stats.lessonsLearned), dailyBrief.data.stats.lessonsLearned === 1 ? 'lesson learned' : 'lessons learned'],
                dailyBrief.data.stats.automationsCompleted > 0 && [String(dailyBrief.data.stats.automationsCompleted), dailyBrief.data.stats.automationsCompleted === 1 ? 'automation completed' : 'automations completed'],
                dailyBrief.data.stats.timeSavedMinutes > 0 && [formatMinutes(dailyBrief.data.stats.timeSavedMinutes), 'time saved'],
              ]
                .filter((x): x is [string, string] => !!x)
                .map(([value, label]) => (
                  <span key={label} style={{ display: 'flex', alignItems: 'baseline', gap: '5px' }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 500, color: palette.teal }}>{value}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', color: palette.faint, letterSpacing: '0.03em' }}>{label}</span>
                  </span>
                ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: '4px', marginBottom: '26px', flexWrap: 'wrap' }}>
            {(Object.keys(CATEGORY_META) as Category[]).map((cat) => (
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
