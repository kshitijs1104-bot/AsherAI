import { useState } from 'react';
import { Target, X, TrendingUp, AlertTriangle, CheckCircle2, ThumbsUp, ThumbsDown, Minus, RotateCcw } from 'lucide-react';
import { prefStorage } from '../lib/cookieConsent';
import {
  useGetChat,
  useSetChatGoal,
  useClearChatGoal,
  useSetGoalStatus,
} from '@workspace/api-client-react';
import type { ChatWithGoal, GoalWithProgress } from '@workspace/api-client-react';

// /ai/decisions/:id/outcome isn't in the OpenAPI spec yet (it predates the
// Goal feature's client generation), so there's no generated hook for it.
// Raw fetch, same pattern as the company-report call elsewhere in Venus.tsx —
// cookies carry auth for same-origin requests in this app, no bearer token
// needed. This is the ONLY write path that moves a goal's evidenceScore
// (see goalEvidence.ts): reporting a subtask's real-world outcome here is
// what lets the Origin──Target marker actually move, including backward on
// a reported failure.
export type OutcomeSentiment = 'positive' | 'negative' | 'mixed';

export async function reportSubTaskOutcome(id: number, outcome: string, sentiment: OutcomeSentiment) {
  const response = await fetch(`/api/ai/decisions/${id}/outcome`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outcome, sentiment }),
  });
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return response.json();
}

// This panel is the actual UI surface for the Goal feature — set once per
// chat, like a Claude Project's custom instructions, with the three fields
// (successMetric, valueInr, deadline) that are the ONLY inputs letting Venus
// reason about urgency/expected-value/trade-offs at all. Deliberately does
// NOT render a uniform progress bar: the position on the line is driven by
// resolved evidence (see goalEvidence.ts), and sub-tasks are listed with
// their own resolved/open/outcome status rather than a checked-off count.
interface GoalPanelProps {
  serverChatId: number | undefined;
  // Called once a chat is lazily created server-side so the parent can
  // persist serverChatId onto the local ChatSession before the goal form
  // can actually target something.
  onRequireServerChat: () => Promise<number>;
}

function formatInr(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

function riskLabel(risk: GoalWithProgress['risk']): { label: string; color: string; Icon: typeof TrendingUp } {
  if (risk === 'on_track') return { label: 'On track', color: 'var(--v7-cyan)', Icon: TrendingUp };
  if (risk === 'at_risk') return { label: 'At risk', color: 'var(--amber, #d9a441)', Icon: AlertTriangle };
  return { label: 'Off track', color: 'var(--red, #e5555c)', Icon: AlertTriangle };
}

// `position` is a soft-compressed [0,1] display value, not the raw evidence
// score — rounding it straight to a percentage is the correct, honest
// reading of "how far along the line the marker sits," which is exactly
// what a founder glancing at the bar wants to know. Floor rather than round
// so a goal never reads as e.g. "100%" until it has actually reached the
// visual end of the line.
function goalPercent(goal: GoalWithProgress): number {
  const clamped = Math.max(0, Math.min(1, goal.position));
  if (clamped <= 0) return 0;
  return Math.max(1, Math.min(100, Math.floor(clamped * 100)));
}

// The Origin ──────◉────── Target line itself. `position` (0..1, already
// soft-compressed past the ends server-side) places the marker; it is NEVER
// a fraction of (tasks done / total tasks) — it's evidence weight. A
// position past 1 or below 0 visually would mean the mapping broke, so the
// bar itself still clamps only the rendered dot to [2%, 98%] for layout
// safety while the raw position value (which can exceed that range slightly
// pre-clamp) is what drives color/label logic above it.
function EvidenceLine({ goal, big }: { goal: GoalWithProgress; big?: boolean }) {
  // Only push the dot off the very edge once there's real, nonzero
  // progress — the [2, 98] safety margin exists so the dot isn't visually
  // clipped by the track's rounded ends, but applying it at position === 0
  // makes a goal with zero evidence look like it already moved, which is
  // exactly the "0% but the dot isn't at Origin" bug. True zero renders
  // pinned to the literal start of the track.
  const rawPct = goal.position * 100;
  const clampedPct = rawPct <= 0 ? 0 : Math.max(2, Math.min(98, rawPct));
  const { label, color, Icon } = riskLabel(goal.risk);
  const pct = goalPercent(goal);
  return (
    <div className={big ? 'mt-2' : 'mt-3'}>
      <div className="flex items-center justify-between mb-2">
        <span
          className="font-mono font-bold"
          style={{ color, fontSize: big ? 26 : 15, lineHeight: 1, letterSpacing: '-0.01em' }}
        >
          {pct}%
        </span>
        <span className="flex items-center gap-1 text-[11px] font-mono" style={{ color }}>
          <Icon className="w-3 h-3" />
          {label}
        </span>
      </div>
      <div className="relative rounded-full" style={{ height: big ? 8 : 6, background: 'var(--v7-bg-raised-2)' }}>
        <div
          className="absolute top-0 left-0 h-full rounded-full"
          style={{ width: `${clampedPct}%`, background: color, opacity: 0.35, transition: 'width 0.4s ease' }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full border-2"
          style={{
            width: big ? 14 : 12,
            height: big ? 14 : 12,
            left: `calc(${clampedPct}% - ${big ? (rawPct <= 0 ? 0 : 7) : (rawPct <= 0 ? 0 : 6)}px)`,
            background: 'var(--v7-bg)',
            borderColor: color,
            boxShadow: `0 0 10px -2px ${color}`,
            transition: 'left 0.4s ease',
          }}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--v7-text-mute)' }}>
        <span>Origin</span>
        <span className="text-right" style={{ maxWidth: '70%' }}>{goal.successMetric}</span>
      </div>
    </div>
  );
}

const REMINDER_STORAGE_PREFIX = 've_outcome_reminder_seen_';

// Local calendar date, not UTC — toISOString() would put the day rollover
// at UTC midnight, which reads as late evening rather than midnight for an
// IST founder (this app's primary audience per its ₹ formatting throughout),
// so the once-a-day reminder would stay suppressed for hours past their
// actual local midnight.
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hasOpenSubTasks(goal: GoalWithProgress): boolean {
  return goal.subTasks.some((t) => t.status !== 'resolved');
}

function isReminderDismissedToday(goalId: number): boolean {
  return prefStorage.getItem(`${REMINDER_STORAGE_PREFIX}${goalId}`) === todayKey();
}

// Best-effort — a private-browsing tab, or a founder who declined optional
// storage in the cookie banner (this prefix is registered there), just means
// the reminder can show again next render, which is harmless.
function dismissReminderForToday(goalId: number) {
  prefStorage.setItem(`${REMINDER_STORAGE_PREFIX}${goalId}`, todayKey());
}

// Non-intrusive nudge to close the loop on an open sub-task. A reported
// outcome is the ONLY thing that moves the goal's evidence score (see
// ReportOutcomeForm/goalEvidence.ts) and the only thing that becomes
// retrievable ground truth for future answers (see retrieveOwnResolvedDecisions
// in ai.ts) — so a sub-task sitting open isn't just an unchecked box, it's
// signal Venus never gets to learn from. Gated to once per calendar day per
// goal via localStorage (same pattern as ve_groq_key/ve_company_reports
// elsewhere in this app) so it surfaces on the first visit of the day and
// then gets out of the way, rather than nagging on every render.
function OutcomeReminderBanner({ goal, onOpen }: { goal: GoalWithProgress; onOpen: () => void }) {
  const [dismissed, setDismissed] = useState(() => isReminderDismissedToday(goal.id));

  if (dismissed || goal.status !== 'active' || !hasOpenSubTasks(goal)) return null;

  return (
    <div
      className="flex items-center gap-2 mb-2.5 px-3 py-2 rounded-lg text-[11px]"
      style={{ background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-border, rgba(255,255,255,0.08))', color: 'var(--v7-text-mute)' }}
    >
      <span className="flex-1 leading-relaxed">
        Reviews help us personalize your AI over time — Day 90 AI &gt;&gt; Day 1 AI.{' '}
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="underline underline-offset-2 font-medium"
          style={{ color: 'var(--v7-cyan)' }}
        >
          Report an outcome
        </button>
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          dismissReminderForToday(goal.id);
          setDismissed(true);
        }}
        aria-label="Dismiss reminder"
        className="shrink-0"
      >
        <X className="w-3 h-3" style={{ color: 'var(--v7-text-mute)' }} />
      </button>
    </div>
  );
}

// Small inline form for reporting what actually happened with an open
// subtask. This was the missing piece: the backend (goalEvidence.ts,
// /ai/decisions/:id/outcome) already knew how to move the goal's
// evidenceScore off a sentiment, but nothing in the UI ever sent one.
function ReportOutcomeForm({ taskId, onDone }: { taskId: number; onDone: () => void }) {
  const [outcome, setOutcome] = useState('');
  const [sentiment, setSentiment] = useState<OutcomeSentiment | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sentimentOptions: { value: OutcomeSentiment; label: string; Icon: typeof ThumbsUp; color: string }[] = [
    { value: 'positive', label: 'Worked', Icon: ThumbsUp, color: 'var(--v7-cyan)' },
    { value: 'mixed', label: 'Mixed', Icon: Minus, color: 'var(--amber, #d9a441)' },
    { value: 'negative', label: "Didn't work", Icon: ThumbsDown, color: 'var(--red, #e5555c)' },
  ];

  const canSubmit = outcome.trim() && sentiment && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !sentiment) return;
    setSubmitting(true);
    setError(null);
    try {
      await reportSubTaskOutcome(taskId, outcome.trim(), sentiment);
      onDone();
    } catch (e) {
      setError('Failed to save — try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-2 p-2 rounded-lg" style={{ background: 'var(--v7-bg-raised-2)', border: '1px solid var(--v7-border, rgba(255,255,255,0.08))' }}>
      <div className="flex gap-1.5 mb-2">
        {sentimentOptions.map(({ value, label, Icon, color }) => {
          const active = sentiment === value;
          return (
            <button
              key={value}
              onClick={() => setSentiment(value)}
              className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md"
              style={{
                color: active ? color : 'var(--v7-text-mute)',
                background: active ? `${color}1a` : 'transparent',
                border: `1px solid ${active ? color : 'var(--v7-border, rgba(255,255,255,0.08))'}`,
              }}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          );
        })}
      </div>
      <textarea
        value={outcome}
        onChange={(e) => setOutcome(e.target.value)}
        placeholder="What actually happened?"
        rows={2}
        className="w-full text-[12px] rounded-md px-2 py-1.5"
        style={{
          background: 'var(--v7-bg)',
          border: '1px solid var(--v7-border, rgba(255,255,255,0.08))',
          color: 'var(--v7-text)',
          resize: 'none',
        }}
      />
      {error && <div className="text-[11px] mt-1" style={{ color: 'var(--red, #e5555c)' }}>{error}</div>}
      <div className="flex gap-2 mt-2">
        <button
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="text-[11px] font-semibold px-2.5 py-1 rounded-md"
          style={{
            background: canSubmit ? 'var(--v7-cyan-soft)' : 'transparent',
            border: `1px solid ${canSubmit ? 'var(--v7-cyan-strong)' : 'var(--v7-border, rgba(255,255,255,0.08))'}`,
            color: canSubmit ? 'var(--v7-cyan)' : 'var(--v7-text-mute)',
          }}
        >
          {submitting ? 'Saving…' : 'Save outcome'}
        </button>
        <button onClick={onDone} className="text-[11px]" style={{ color: 'var(--v7-text-mute)' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function SubTaskList({ subTasks, onResolved }: { subTasks: GoalWithProgress['subTasks']; onResolved: () => void }) {
  const [reportingId, setReportingId] = useState<number | null>(null);

  if (subTasks.length === 0) {
    return (
      <div className="text-[12px] mt-3" style={{ color: 'var(--v7-text-mute)' }}>
        No roadmap items yet — the next decision or roadmap card Vera gives you in this chat becomes evidence here automatically.
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-1.5">
      {subTasks.map((t) => {
        const resolved = t.status === 'resolved';
        const dotColor = t.outcomeSentiment === 'positive'
          ? 'var(--v7-cyan)'
          : t.outcomeSentiment === 'negative'
            ? 'var(--red, #e5555c)'
            : 'var(--v7-text-mute)';
        const reporting = reportingId === t.id;
        return (
          <div key={t.id} className="text-[12px]" style={{ color: 'var(--v7-text-dim)' }}>
            <div className="flex items-start gap-2">
              <span
                className="mt-1 w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: resolved ? dotColor : 'transparent', border: resolved ? 'none' : '1px solid var(--v7-text-mute)' }}
              />
              <span className="flex-1">
                {t.summary}
                {!resolved && !reporting && (
                  <>
                    <span style={{ color: 'var(--v7-text-mute)' }}> — not yet resolved · </span>
                    <button
                      onClick={() => setReportingId(t.id)}
                      className="underline underline-offset-2"
                      style={{ color: 'var(--v7-cyan)' }}
                    >
                      report outcome
                    </button>
                  </>
                )}
              </span>
            </div>
            {reporting && (
              <ReportOutcomeForm
                taskId={t.id}
                onDone={() => {
                  setReportingId(null);
                  onResolved();
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SetGoalForm({ onSubmit, onCancel, submitting, initial }: {
  onSubmit: (input: { title: string; successMetric: string; valueInr: number; deadline: string }) => void;
  onCancel: () => void;
  submitting: boolean;
  // Present when editing an already-set goal. Pre-fills every field with
  // its current value so editing one thing (e.g. bumping the value from
  // 10L to 1Cr) doesn't force retyping the title/metric/deadline too — the
  // form now always carries the goal's current state forward, and only the
  // field the founder actually touches changes on submit.
  initial?: { title: string; successMetric: string; valueInr: number; deadline: string };
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [successMetric, setSuccessMetric] = useState(initial?.successMetric ?? '');
  const [valueInr, setValueInr] = useState(initial ? String(initial.valueInr) : '');
  // <input type="date"> needs yyyy-mm-dd; the stored deadline is a full
  // ISO timestamp, so slice it down rather than reformatting.
  const [deadline, setDeadline] = useState(initial ? initial.deadline.slice(0, 10) : '');

  const canSubmit = title.trim() && successMetric.trim() && valueInr.trim() && deadline.trim();

  const inputStyle = {
    width: '100%',
    background: 'var(--v7-bg-raised-2)',
    border: '1px solid var(--v7-border, rgba(255,255,255,0.08))',
    borderRadius: 10,
    padding: '8px 10px',
    fontSize: 13,
    color: 'var(--v7-text)',
    marginTop: 4,
    marginBottom: 10,
  } as const;
  const labelStyle = { fontSize: 11, fontFamily: 'var(--v7-font-mono)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: 'var(--v7-text-mute)' };

  return (
    <div>
      <label style={labelStyle}>Goal</label>
      <input
        style={inputStyle}
        placeholder='e.g. "Close Client X"'
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label style={labelStyle}>Success metric — the concrete win condition</label>
      <input
        style={inputStyle}
        placeholder='e.g. "Demo scheduled and signed by [date]"'
        value={successMetric}
        onChange={(e) => setSuccessMetric(e.target.value)}
      />
      <label style={labelStyle}>Value if hit (₹)</label>
      <input
        style={inputStyle}
        type="number"
        min={0}
        placeholder="e.g. 500000"
        value={valueInr}
        onChange={(e) => setValueInr(e.target.value)}
      />
      <label style={labelStyle}>Deadline</label>
      <input
        style={inputStyle}
        type="date"
        value={deadline}
        onChange={(e) => setDeadline(e.target.value)}
      />
      <div className="text-[11px] mb-3" style={{ color: 'var(--v7-text-mute)' }}>
        All four are required — without a concrete metric, value, and deadline Vera can't reason about urgency or trade-offs in this chat.
      </div>
      <div className="flex gap-2">
        <button
          disabled={!canSubmit || submitting}
          onClick={() => onSubmit({
            title: title.trim(),
            successMetric: successMetric.trim(),
            valueInr: Number(valueInr),
            deadline: new Date(deadline).toISOString(),
          })}
          className="text-[13px] font-semibold px-3 py-2 rounded-lg"
          style={{
            background: canSubmit ? 'var(--v7-cyan-soft)' : 'var(--v7-bg-raised-2)',
            border: `1px solid ${canSubmit ? 'var(--v7-cyan-strong)' : 'transparent'}`,
            color: canSubmit ? 'var(--v7-cyan)' : 'var(--v7-text-mute)',
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? 'Saving…' : 'Set Goal'}
        </button>
        <button
          onClick={onCancel}
          className="text-[13px] px-3 py-2 rounded-lg"
          style={{ color: 'var(--v7-text-mute)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function GoalPanel({ serverChatId, onRequireServerChat }: GoalPanelProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const chatQuery = useGetChat(serverChatId ?? -1, { query: { enabled: !!serverChatId, queryKey: ['/api/chats', serverChatId ?? -1] } });
  const setGoal = useSetChatGoal();
  const clearGoal = useClearChatGoal();
  const setStatus = useSetGoalStatus();

  const chat = chatQuery.data as ChatWithGoal | undefined;
  const goal = chat?.goal;

  const handleSubmit = async (input: { title: string; successMetric: string; valueInr: number; deadline: string }) => {
    const id = serverChatId ?? (await onRequireServerChat());
    setGoal.mutate(
      { id, data: input },
      { onSuccess: () => { setEditing(false); chatQuery.refetch(); } },
    );
  };

  const handleClear = () => {
    if (!serverChatId) return;
    clearGoal.mutate({ id: serverChatId }, { onSuccess: () => chatQuery.refetch() });
  };

  const handleResolve = (nextStatus: 'completed' | 'abandoned') => {
    if (!serverChatId) return;
    setStatus.mutate({ id: serverChatId, data: { status: nextStatus } }, { onSuccess: () => chatQuery.refetch() });
  };

  // Undo for an accidental "mark completed"/"mark abandoned" click — a
  // single misclick previously had no way back short of re-submitting the
  // whole goal form. Always available (not a time-limited toast) so it
  // still works even if the founder doesn't notice the mistake right away.
  const handleReopen = () => {
    if (!serverChatId) return;
    setStatus.mutate({ id: serverChatId, data: { status: 'active' } }, { onSuccess: () => chatQuery.refetch() });
  };

  if (!open) {
    // No goal set yet — still a real affordance, just smaller, since there's
    // nothing to show a bar for. Clicking opens the panel to set one.
    if (!goal) {
      return (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg mb-3"
          style={{ color: 'var(--v7-text-mute)', border: '1px solid var(--v7-border, rgba(255,255,255,0.08))' }}
        >
          <Target className="w-3 h-3" />
          No goal set
        </button>
      );
    }

    // The persistent, always-visible bar — replaces the old small pill
    // button. Goal title big and centered, full Origin→Target bar with a
    // percentage underneath, stays on screen whether or not the detail
    // panel is open. Clicking anywhere opens the detail view (the popup
    // from the original screenshot).
    return (
      <>
        <OutcomeReminderBanner key={goal.id} goal={goal} onOpen={() => setOpen(true)} />
        <button
          onClick={() => setOpen(true)}
          className="w-full text-left mb-2.5 px-3 py-2 rounded-xl block"
          style={{ background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-cyan-strong)' }}
        >
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className="flex items-center gap-1.5 min-w-0">
              <Target className="w-3 h-3 shrink-0" style={{ color: 'var(--v7-cyan)' }} />
              <span className="text-[13px] font-bold truncate" style={{ color: 'var(--v7-text)' }}>{goal.title}</span>
            </span>
            <span className="text-[10.5px] shrink-0" style={{ color: 'var(--v7-text-mute)' }}>
              {formatInr(goal.valueInr)} · due {new Date(goal.deadline).toLocaleDateString()}
            </span>
          </div>
          <EvidenceLine goal={goal} />
        </button>
      </>
    );
  }

  return (
    <div
      className="mb-3 p-3 rounded-xl"
      style={{ background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-border, rgba(255,255,255,0.08))' }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: 'var(--v7-text)' }}>
          <Target className="w-3.5 h-3.5" />
          Chat Goal
        </span>
        <button onClick={() => setOpen(false)}>
          <X className="w-3.5 h-3.5" style={{ color: 'var(--v7-text-mute)' }} />
        </button>
      </div>

      {!goal && !editing && (
        <div>
          <div className="text-[12px] mb-2" style={{ color: 'var(--v7-text-mute)' }}>
            Give this chat one named goal — Vera will weigh urgency, value, and trade-offs against it in every answer here.
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-[13px] font-semibold px-3 py-2 rounded-lg"
            style={{ background: 'var(--v7-cyan-soft)', border: '1px solid var(--v7-cyan-strong)', color: 'var(--v7-cyan)' }}
          >
            Set Goal
          </button>
        </div>
      )}

      {editing && (
        <SetGoalForm
          // Keyed on chat+goal identity, not just conditionally rendered:
          // GoalPanel itself is never remounted when the founder switches
          // chats (no key on <GoalPanel> in Venus.tsx), so without this the
          // form's useState-seeded fields would keep showing whichever
          // goal/chat they were mounted with if `editing` is left open
          // across a chat switch — silently submitting stale data onto the
          // newly-selected chat's goal.
          key={`${serverChatId ?? 'local'}-${goal?.id ?? 'new'}`}
          onSubmit={handleSubmit}
          onCancel={() => setEditing(false)}
          submitting={setGoal.isPending}
          initial={goal ? { title: goal.title, successMetric: goal.successMetric, valueInr: goal.valueInr, deadline: goal.deadline } : undefined}
        />
      )}

      {goal && !editing && (
        <div>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[14px] font-semibold" style={{ color: 'var(--v7-text)' }}>{goal.title}</div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--v7-text-mute)' }}>
                {formatInr(goal.valueInr)} · due {new Date(goal.deadline).toLocaleDateString()}
              </div>
            </div>
            {goal.status === 'active' && (
              <div className="flex gap-1 shrink-0">
                <button
                  title="Mark completed"
                  onClick={() => handleResolve('completed')}
                  className="p-1.5 rounded-lg"
                  style={{ color: 'var(--v7-cyan)' }}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {goal.status !== 'active' && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] font-mono uppercase" style={{ color: 'var(--v7-text-mute)' }}>
                {goal.status}
              </span>
              <button
                onClick={handleReopen}
                title="Undo — reopen this goal"
                className="flex items-center gap-1 text-[11px] font-medium underline underline-offset-2"
                style={{ color: 'var(--v7-cyan)' }}
              >
                <RotateCcw className="w-3 h-3" />
                Undo
              </button>
            </div>
          )}

          <EvidenceLine goal={goal} />
          <SubTaskList subTasks={goal.subTasks} onResolved={() => chatQuery.refetch()} />

          <div className="flex gap-3 mt-3">
            <button onClick={() => setEditing(true)} className="text-[11px]" style={{ color: 'var(--v7-text-mute)' }}>
              Edit
            </button>
            <button onClick={handleClear} className="text-[11px]" style={{ color: 'var(--v7-text-mute)' }}>
              Remove goal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}