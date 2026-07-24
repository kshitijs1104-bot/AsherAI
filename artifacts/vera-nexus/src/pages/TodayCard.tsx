import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { Sunrise, Sun, MoonStar, ChevronUp, ChevronDown, ThumbsUp, ThumbsDown, Minus, X, Check } from 'lucide-react';
import {
  useGoals,
  useDailyBrief,
  useAddCompanyFact,
  useRoadmap,
  useSetRoadmapActionStatus,
  type DailyBriefStats,
} from '../lib/venusApi';

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

// The Business Stats row (see build plan section 7) — replaces the old
// ad-hoc decisions/goals/value strip with exactly four counters, all of
// them plain accumulating counts that only ever go up: Decisions Captured,
// Lessons Learned, Automations Completed, Time Saved. Deliberately no
// percentage or completeness score anywhere here — the point is "operating
// history I'm building," not "a profile I haven't finished." The queue-clear
// streak renders as a fifth, equally plain counter rather than a badge —
// "day I cleared queue," not a gamification level.
export function StatsStrip({ stats }: { stats: DailyBriefStats }) {
  const items: { label: string; value: string }[] = [];
  if (stats.decisionsCaptured > 0) items.push({ label: stats.decisionsCaptured === 1 ? 'decision captured' : 'decisions captured', value: String(stats.decisionsCaptured) });
  if (stats.lessonsLearned > 0) items.push({ label: stats.lessonsLearned === 1 ? 'lesson learned' : 'lessons learned', value: String(stats.lessonsLearned) });
  if (stats.automationsCompleted > 0) items.push({ label: stats.automationsCompleted === 1 ? 'automation completed' : 'automations completed', value: String(stats.automationsCompleted) });
  if (stats.timeSavedMinutes > 0) items.push({ label: 'time saved', value: formatMinutes(stats.timeSavedMinutes) });
  if (stats.queueStreakDays > 0) items.push({ label: stats.queueStreakDays === 1 ? 'day streak' : 'day streak', value: String(stats.queueStreakDays) });

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-2.5 pb-2.5" style={{ borderBottom: '1px solid var(--v7-tint-border)' }}>
      {items.map((item) => (
        <span key={item.label} className="flex items-baseline gap-1">
          <span className="text-[13px] font-bold" style={{ color: 'var(--v7-text)' }}>{item.value}</span>
          <span className="text-[10.5px]" style={{ color: 'var(--v7-text-mute)' }}>{item.label}</span>
        </span>
      ))}
    </div>
  );
}
import { reportSubTaskOutcome, type OutcomeSentiment } from './GoalPanel';

// Morning Check-In + Decision Inbox — NOT new features, both are views over
// the same Goal/Roadmap/Decision/Company-Memory data GoalPanel,
// RoadmapTracker, and DecisionsOverview already read and write. Deliberately
// styled and placed differently from those two: it only ever renders on the
// "new chat" landing view (see Venus.tsx), not as another permanent bar
// stacked above every chat thread, and it disappears the moment the founder
// clears it — same once-a-day localStorage gate GoalPanel's
// OutcomeReminderBanner already uses, just for the whole card rather than
// one goal's reminder.
const DISMISS_KEY = 've_today_seen';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isDismissedToday(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === todayKey();
  } catch {
    return false;
  }
}

function dismissToday() {
  try {
    localStorage.setItem(DISMISS_KEY, todayKey());
  } catch {
    // Best-effort — a private-browsing tab with no localStorage just means
    // the card can reappear next reload, which is harmless.
  }
}

// Reads the device's own clock, not a server timestamp — this card can pop
// up any time of day (first open, not literally sunrise), but the greeting
// it shows must actually match when the founder is looking at it, or
// "Good morning" at 6pm reads as broken rather than warm.
function greeting(): { text: string; Icon: typeof Sunrise } {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return { text: 'Good morning', Icon: Sunrise };
  if (hour >= 12 && hour < 17) return { text: 'Good afternoon', Icon: Sun };
  return { text: 'Good evening', Icon: MoonStar };
}

type CheckinStep =
  | { kind: 'subtask'; subtaskId: number; summary: string }
  | { kind: 'roadmap'; roadmapId: number; phaseIndex: number; actionIndex: number; text: string }
  | { kind: 'freeform' };

const SENTIMENT_OPTIONS: { value: OutcomeSentiment; label: string; Icon: typeof ThumbsUp; color: string }[] = [
  { value: 'positive', label: 'Worked', Icon: ThumbsUp, color: 'var(--v7-cyan)' },
  { value: 'mixed', label: 'Mixed', Icon: Minus, color: 'var(--amber, #d9a441)' },
  { value: 'negative', label: "Didn't work", Icon: ThumbsDown, color: 'var(--red, #e5555c)' },
];

// The one question for the day — chosen by adapting to the active goal, in
// priority order: an unresolved outcome first (it's the only thing that
// moves the goal's evidence score), then the next pending roadmap action,
// then — only if there's no active goal to ask about at all — a single
// open-ended prompt. Never more than one question.
function SubtaskStep({ subtaskId, summary, onDone }: { subtaskId: number; summary: string; onDone: () => void }) {
  const [sentiment, setSentiment] = useState<OutcomeSentiment | null>(null);
  const [outcome, setOutcome] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = sentiment && outcome.trim() && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !sentiment) return;
    setSubmitting(true);
    try {
      await reportSubTaskOutcome(subtaskId, outcome.trim(), sentiment);
      onDone();
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="text-[12.5px] mb-2" style={{ color: 'var(--v7-text)' }}>
        Any movement on <span style={{ color: 'var(--v7-text-dim)' }}>&ldquo;{summary}&rdquo;</span>?
      </div>
      <div className="flex gap-1.5 mb-2">
        {SENTIMENT_OPTIONS.map(({ value, label, Icon, color }) => {
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
      <div className="flex items-center gap-2">
        <input
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          placeholder="What actually happened? (one line)"
          className="flex-1 text-[12px] rounded-md px-2 py-1.5"
          style={{ background: 'var(--v7-bg-raised-2)', border: '1px solid var(--v7-border, rgba(255,255,255,0.08))', color: 'var(--v7-text)' }}
        />
        <button
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md shrink-0"
          style={{
            background: canSubmit ? 'var(--v7-pink-soft, rgba(255,122,209,0.14))' : 'transparent',
            border: `1px solid ${canSubmit ? 'var(--v7-pink)' : 'var(--v7-border, rgba(255,255,255,0.08))'}`,
            color: canSubmit ? 'var(--v7-pink)' : 'var(--v7-text-mute)',
          }}
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function RoadmapStep({
  roadmapId,
  phaseIndex,
  actionIndex,
  text,
  onDone,
}: {
  roadmapId: number;
  phaseIndex: number;
  actionIndex: number;
  text: string;
  onDone: () => void;
}) {
  const setAction = useSetRoadmapActionStatus();

  const markDone = () => {
    setAction.mutate({ roadmapId, phaseIndex, actionIndex, status: 'done' }, { onSuccess: onDone });
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-[12.5px]" style={{ color: 'var(--v7-text)' }}>
        Did you get to <span style={{ color: 'var(--v7-text-dim)' }}>&ldquo;{text}&rdquo;</span>?
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          disabled={setAction.isPending}
          onClick={markDone}
          className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-md"
          style={{ background: 'var(--v7-pink-soft, rgba(255,122,209,0.14))', border: '1px solid var(--v7-pink)', color: 'var(--v7-pink)' }}
        >
          <Check className="w-3 h-3" />
          Done
        </button>
        <button onClick={onDone} className="text-[11px]" style={{ color: 'var(--v7-text-mute)' }}>
          Not yet
        </button>
      </div>
    </div>
  );
}

function FreeformStep({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('');
  const addFact = useAddCompanyFact();

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    addFact.mutate({ factText: trimmed, sourceType: 'checkin' }, { onSuccess: onDone });
  };

  return (
    <div>
      <div className="text-[12.5px] mb-2" style={{ color: 'var(--v7-text)' }}>
        Anything changed since last time?
      </div>
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          placeholder="e.g. we shipped the pricing change"
          className="flex-1 text-[12px] rounded-md px-2 py-1.5"
          style={{ background: 'var(--v7-bg-raised-2)', border: '1px solid var(--v7-border, rgba(255,255,255,0.08))', color: 'var(--v7-text)' }}
        />
        <button
          disabled={!text.trim() || addFact.isPending}
          onClick={handleSubmit}
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md shrink-0"
          style={{
            background: text.trim() ? 'var(--v7-pink-soft, rgba(255,122,209,0.14))' : 'transparent',
            border: `1px solid ${text.trim() ? 'var(--v7-pink)' : 'var(--v7-border, rgba(255,255,255,0.08))'}`,
            color: text.trim() ? 'var(--v7-pink)' : 'var(--v7-text-mute)',
          }}
        >
          {addFact.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export function TodayCard() {
  const [, navigate] = useLocation();
  // Starts expanded, not collapsed like GoalPanel/RoadmapTracker — this
  // only ever appears once, on the landing view, with nothing else on
  // screen competing for attention yet, so making the founder click twice
  // to even see what it wants is pure friction. Still collapsible for
  // anyone who wants it out of the way while they read the rest of the page.
  const [open, setOpen] = useState(true);
  const [dismissed, setDismissed] = useState(isDismissedToday);

  const goalsQuery = useGoals();
  const activeGoal = useMemo(() => {
    // /api/goals already orders most-recently-updated first, so the first
    // active row IS "the" active goal a founder is currently pushing on.
    return goalsQuery.data?.goals.find((g) => g.status === 'active') ?? null;
  }, [goalsQuery.data]);

  const roadmapQuery = useRoadmap(activeGoal?.chatId);
  const briefQuery = useDailyBrief();

  const checkinStep = useMemo<CheckinStep | null>(() => {
    if (activeGoal) {
      const openSubtask = activeGoal.subTasks.find((t) => t.status === 'open');
      if (openSubtask) return { kind: 'subtask', subtaskId: openSubtask.id, summary: openSubtask.summary };

      const roadmap = roadmapQuery.data;
      if (roadmap) {
        for (let phaseIndex = 0; phaseIndex < roadmap.phases.length; phaseIndex++) {
          const actionIndex = roadmap.phases[phaseIndex].actions.findIndex((a) => a.status === 'pending');
          if (actionIndex !== -1) {
            return { kind: 'roadmap', roadmapId: roadmap.id, phaseIndex, actionIndex, text: roadmap.phases[phaseIndex].actions[actionIndex].text };
          }
        }
      }
      // Active goal exists but nothing open to ask about — genuinely
      // nothing to check in on, not a fallback-to-generic-question moment.
      return null;
    }
    // No active goal at all. Wait for the goals list to actually resolve so
    // this doesn't briefly show, then disappear, once real goals load.
    return goalsQuery.isSuccess ? { kind: 'freeform' } : null;
  }, [activeGoal, roadmapQuery.data, goalsQuery.isSuccess]);

  const inboxItems = useMemo(() => {
    const brief = briefQuery.data;
    if (!brief) return [];
    const items: { key: string; label: string; text: string; onClick?: () => void }[] = [];
    if (brief.topDecision) {
      items.push({ key: 'decision', label: 'Decision', text: brief.topDecision.query, onClick: () => navigate('/venus/decisions') });
    }
    if (brief.biggestRisk) {
      items.push({
        key: 'risk',
        label: brief.biggestRisk.risk === 'off_track' ? 'Off track' : 'At risk',
        text: brief.biggestRisk.title,
        onClick: () => navigate('/venus/goals'),
      });
    }
    if (brief.blockedTask) {
      items.push({ key: 'blocked', label: 'Blocked', text: brief.blockedTask.actionText });
    }
    if (brief.assumptionChange) {
      const text = brief.assumptionChange.previousText
        ? `Was "${brief.assumptionChange.previousText}" — now "${brief.assumptionChange.currentText}"`
        : brief.assumptionChange.currentText;
      items.push({ key: 'assumption', label: 'Changed', text });
    }
    return items;
  }, [briefQuery.data, navigate]);

  const handleDismiss = () => {
    dismissToday();
    setDismissed(true);
  };

  const stats = briefQuery.data?.stats ?? null;
  const hasStats = !!stats && (stats.decisionsCaptured > 0 || stats.lessonsLearned > 0 || stats.automationsCompleted > 0 || stats.timeSavedMinutes > 0 || stats.queueStreakDays > 0);

  if (dismissed) return null;
  // A stat worth showing is its own reason to keep this card up, even on a
  // day with no open question and nothing flagged — it's the one thing here
  // that's purely a "look what's compounding" signal, not a task.
  if (!checkinStep && inboxItems.length === 0 && !hasStats) return null;

  const { text: greetingText, Icon: GreetingIcon } = greeting();
  const cardStyle = {
    background: 'linear-gradient(135deg, var(--v7-glow-1), var(--v7-glow-2))',
    border: '1px solid var(--v7-tint-border)',
  };

  if (!open) {
    const parts: string[] = [];
    if (checkinStep) parts.push('1 quick question');
    if (inboxItems.length > 0) parts.push(`${inboxItems.length} flagged`);
    if (hasStats && stats) {
      if (stats.queueStreakDays > 0) parts.push(`${stats.queueStreakDays} day${stats.queueStreakDays === 1 ? '' : 's'} streak`);
      else if (stats.decisionsCaptured > 0) parts.push(`${stats.decisionsCaptured} decision${stats.decisionsCaptured === 1 ? '' : 's'} captured`);
    }
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left mb-5 flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl"
        style={cardStyle}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'var(--v7-pink-soft)' }}
          >
            <GreetingIcon className="w-3 h-3" style={{ color: 'var(--v7-pink)' }} />
          </span>
          <span className="text-[12px] font-semibold truncate" style={{ color: 'var(--v7-text)' }}>
            {greetingText} — {parts.join(' · ')}
          </span>
        </span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--v7-text-mute)' }} />
      </button>
    );
  }

  return (
    <div className="w-full mb-5 p-3.5 rounded-2xl text-left" style={cardStyle}>
      <div className="flex items-center justify-between mb-2.5">
        <span className="flex items-center gap-2 text-[12px] font-bold" style={{ color: 'var(--v7-text)' }}>
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'var(--v7-pink-soft)' }}
          >
            <GreetingIcon className="w-3 h-3" style={{ color: 'var(--v7-pink)' }} />
          </span>
          {greetingText}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen(false)}>
            <ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--v7-text-mute)' }} />
          </button>
          <button onClick={handleDismiss} aria-label="Dismiss for today">
            <X className="w-3.5 h-3.5" style={{ color: 'var(--v7-text-mute)' }} />
          </button>
        </div>
      </div>

      {hasStats && stats && <StatsStrip stats={stats} />}

      {checkinStep && (
        <div className="pb-2.5 mb-2.5" style={{ borderBottom: inboxItems.length > 0 ? '1px solid var(--v7-tint-border)' : 'none' }}>
          {checkinStep.kind === 'subtask' && (
            <SubtaskStep subtaskId={checkinStep.subtaskId} summary={checkinStep.summary} onDone={handleDismiss} />
          )}
          {checkinStep.kind === 'roadmap' && (
            <RoadmapStep
              roadmapId={checkinStep.roadmapId}
              phaseIndex={checkinStep.phaseIndex}
              actionIndex={checkinStep.actionIndex}
              text={checkinStep.text}
              onDone={handleDismiss}
            />
          )}
          {checkinStep.kind === 'freeform' && <FreeformStep onDone={handleDismiss} />}
        </div>
      )}

      {inboxItems.length > 0 && (
        <div className="space-y-1.5">
          {inboxItems.map((item) => (
            <div
              key={item.key}
              onClick={item.onClick}
              role={item.onClick ? 'button' : undefined}
              tabIndex={item.onClick ? 0 : undefined}
              onKeyDown={item.onClick ? (e) => { if (e.key === 'Enter') item.onClick!(); } : undefined}
              className="w-full flex items-baseline gap-2 text-left"
              style={{ cursor: item.onClick ? 'pointer' : 'default' }}
            >
              <span
                className="text-[9.5px] font-mono uppercase shrink-0 px-1.5 py-0.5 rounded"
                style={{ background: 'var(--v7-pink-soft)', color: 'var(--v7-pink)' }}
              >
                {item.label}
              </span>
              <span
                className="text-[12px] truncate"
                style={{
                  color: item.onClick ? 'var(--v7-text-dim)' : 'var(--v7-text-mute)',
                  textDecoration: item.onClick ? 'underline' : 'none',
                  textUnderlineOffset: '2px',
                }}
              >
                {item.text}
              </span>
            </div>
          ))}

          {/* No question was asked this round (no active goal to check in
              on) — reading the flagged items IS the whole interaction, so
              give it an explicit, obvious way to be marked handled instead
              of relying on the small corner X. */}
          {!checkinStep && (
            <button
              onClick={handleDismiss}
              className="text-[11px] font-semibold mt-1"
              style={{ color: 'var(--v7-pink)' }}
            >
              Got it — clear for today
            </button>
          )}
        </div>
      )}
    </div>
  );
}
