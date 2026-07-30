import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { Sunrise, Sun, MoonStar, ChevronUp, ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, Minus, X, Check } from 'lucide-react';
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
  // Label is split into a number and a NOUN, with the qualifier dropped
  // ("decisions", not "decisions captured"). The previous version ran the
  // full phrase inline at 10.5px, which produced a single unbroken 60-
  // character line — "2 decisions captured 1 lesson learned 1 automation
  // completed 12m time saved 1 day streak" — that reads as one long string
  // rather than five separate facts. Tiles with the number on its own line
  // are legible at a glance, which is the only way this row is ever read.
  const items: { label: string; value: string }[] = [];
  if (stats.decisionsCaptured > 0) items.push({ label: stats.decisionsCaptured === 1 ? 'decision' : 'decisions', value: String(stats.decisionsCaptured) });
  if (stats.lessonsLearned > 0) items.push({ label: stats.lessonsLearned === 1 ? 'lesson' : 'lessons', value: String(stats.lessonsLearned) });
  if (stats.automationsCompleted > 0) items.push({ label: stats.automationsCompleted === 1 ? 'automation' : 'automations', value: String(stats.automationsCompleted) });
  if (stats.timeSavedMinutes > 0) items.push({ label: 'time saved', value: formatMinutes(stats.timeSavedMinutes) });
  if (stats.queueStreakDays > 0) items.push({ label: stats.queueStreakDays === 1 ? 'day streak' : 'day streak', value: String(stats.queueStreakDays) });

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="ve-tile rounded-xl px-3.5 py-2.5 flex-1 min-w-[92px]"
          style={{ background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-border)' }}
        >
          <div className="text-[20px] font-extrabold leading-none tracking-[-0.02em]" style={{ color: 'var(--v7-text)' }}>
            {item.value}
          </div>
          <div className="text-[11px] mt-1.5 leading-tight" style={{ color: 'var(--v7-text-mute)' }}>
            {item.label}
          </div>
        </div>
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
      <div className="text-[13.5px] mb-3 leading-relaxed" style={{ color: 'var(--v7-text)' }}>
        Any movement on <span style={{ color: 'var(--v7-text-dim)' }}>&ldquo;{summary}&rdquo;</span>?
      </div>
      <div className="flex gap-1.5 mb-2">
        {SENTIMENT_OPTIONS.map(({ value, label, Icon, color }) => {
          const active = sentiment === value;
          return (
            <button
              key={value}
              onClick={() => setSentiment(value)}
              className="flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg"
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
          className="flex-1 text-[13px] rounded-lg px-3 py-2 outline-none"
          style={{ background: 'var(--v7-bg-raised-2)', border: '1px solid var(--v7-border, rgba(255,255,255,0.08))', color: 'var(--v7-text)' }}
        />
        <button
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="text-[12px] font-semibold px-3.5 py-2 rounded-lg shrink-0"
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
      <div className="text-[13.5px] leading-relaxed" style={{ color: 'var(--v7-text)' }}>
        Did you get to <span style={{ color: 'var(--v7-text-dim)' }}>&ldquo;{text}&rdquo;</span>?
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          disabled={setAction.isPending}
          onClick={markDone}
          className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-2 rounded-lg"
          style={{ background: 'var(--v7-pink-soft, rgba(255,122,209,0.14))', border: '1px solid var(--v7-pink)', color: 'var(--v7-pink)' }}
        >
          <Check className="w-3 h-3" />
          Done
        </button>
        <button onClick={onDone} className="text-[12px] px-2 py-2" style={{ color: 'var(--v7-text-mute)' }}>
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
      <div className="text-[13.5px] mb-3 leading-relaxed" style={{ color: 'var(--v7-text)' }}>
        Anything changed since last time?
      </div>
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          placeholder="e.g. we shipped the pricing change"
          className="flex-1 text-[13px] rounded-lg px-3 py-2 outline-none"
          style={{ background: 'var(--v7-bg-raised-2)', border: '1px solid var(--v7-border, rgba(255,255,255,0.08))', color: 'var(--v7-text)' }}
        />
        <button
          disabled={!text.trim() || addFact.isPending}
          onClick={handleSubmit}
          className="text-[12px] font-semibold px-3.5 py-2 rounded-lg shrink-0"
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
      items.push({ key: 'decision', label: 'Decision', text: brief.topDecision.query, onClick: () => navigate('/vera/decisions') });
    }
    if (brief.biggestRisk) {
      items.push({
        key: 'risk',
        label: brief.biggestRisk.risk === 'off_track' ? 'Off track' : 'At risk',
        text: brief.biggestRisk.title,
        onClick: () => navigate('/vera/goals'),
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
        className="ve-tile w-full text-left mb-5 flex items-center justify-between gap-3 px-4 py-3.5 rounded-[20px]"
        style={cardStyle}
      >
        <span className="flex items-center gap-3 min-w-0">
          <span
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'var(--v7-pink-soft)' }}
          >
            <GreetingIcon className="w-4 h-4" style={{ color: 'var(--v7-pink)' }} />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-bold truncate" style={{ color: 'var(--v7-text)' }}>
              {greetingText}
            </span>
            <span className="block text-[12px] truncate" style={{ color: 'var(--v7-text-mute)' }}>
              {parts.join(' · ')}
            </span>
          </span>
        </span>
        <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--v7-text-mute)' }} />
      </button>
    );
  }

  // Today's date, spelled out. The card previously said only "Good evening",
  // which is a greeting and not information — with a date it is legible as a
  // dated briefing, which is what it actually is.
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="w-full mb-5 p-5 sm:p-6 rounded-[20px] text-left" style={cardStyle}>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'var(--v7-pink-soft)' }}
          >
            <GreetingIcon className="w-[18px] h-[18px]" style={{ color: 'var(--v7-pink)' }} />
          </span>
          <div className="min-w-0">
            <div className="text-[16px] font-extrabold leading-tight tracking-[-0.01em]" style={{ color: 'var(--v7-text)' }}>
              {greetingText}
            </div>
            <div className="text-[12px] mt-0.5" style={{ color: 'var(--v7-text-mute)' }}>
              {dateLine}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setOpen(false)}
            aria-label="Collapse"
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--v7-bg-raised)]"
          >
            <ChevronUp className="w-4 h-4" style={{ color: 'var(--v7-text-mute)' }} />
          </button>
          <button
            onClick={handleDismiss}
            aria-label="Dismiss for today"
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--v7-bg-raised)]"
          >
            <X className="w-4 h-4" style={{ color: 'var(--v7-text-mute)' }} />
          </button>
        </div>
      </div>

      {/* Each of the three blocks below is given a heading naming what it is
          and why it is there. Unlabelled, the card was a stack of small grey
          rows with no way to tell a statistic from a question from a flag —
          which is what made it read as noise rather than a briefing. */}
      {hasStats && stats && (
        <Section title="Where you're at" hint="Counts that only go up, since you started.">
          <StatsStrip stats={stats} />
        </Section>
      )}

      {checkinStep && (
        <Section title="One question" hint="Answering this is what keeps the advice grounded.">
          <div className="rounded-xl p-4" style={{ background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-border)' }}>
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
        </Section>
      )}

      {inboxItems.length > 0 && (
        <Section title="Needs your attention" hint={`${inboxItems.length} thing${inboxItems.length === 1 ? '' : 's'} Vera flagged from your activity.`}>
          <div className="space-y-2">
            {inboxItems.map((item, i) => (
              <div
                key={item.key}
                onClick={item.onClick}
                role={item.onClick ? 'button' : undefined}
                tabIndex={item.onClick ? 0 : undefined}
                onKeyDown={item.onClick ? (e) => { if (e.key === 'Enter') item.onClick!(); } : undefined}
                className="ve-row-in w-full flex items-start gap-3 text-left rounded-xl p-3.5 transition-colors"
                style={{
                  background: 'var(--v7-bg-raised)',
                  border: '1px solid var(--v7-border)',
                  cursor: item.onClick ? 'pointer' : 'default',
                  animationDelay: `${i * 55}ms`,
                }}
              >
                <span
                  className="text-[10px] font-mono uppercase shrink-0 px-2 py-1 rounded-md tracking-wider"
                  style={{ background: 'var(--v7-pink-soft)', color: 'var(--v7-pink)' }}
                >
                  {item.label}
                </span>
                {/* Wraps to two lines instead of truncating to one. A flag
                    whose text is cut off at "Was \"I run a seed-stage B2B
                    fintech SaaS selling to small accounting f…" tells the
                    founder nothing they can act on. */}
                <span
                  className="text-[13px] leading-relaxed flex-1 min-w-0"
                  style={{
                    color: item.onClick ? 'var(--v7-text)' : 'var(--v7-text-dim)',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {item.text}
                </span>
                {item.onClick && (
                  <ChevronRight className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--v7-text-mute)' }} />
                )}
              </div>
            ))}
          </div>

          {/* No question was asked this round (no active goal to check in
              on) — reading the flagged items IS the whole interaction, so
              give it an explicit, obvious way to be marked handled instead
              of relying on the small corner X. */}
          {!checkinStep && (
            <button
              onClick={handleDismiss}
              className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg transition-colors"
              style={{ background: 'var(--v7-pink-soft)', color: 'var(--v7-pink)' }}
            >
              <Check className="w-3.5 h-3.5" />
              Got it — clear for today
            </button>
          )}
        </Section>
      )}
    </div>
  );
}

// A titled block inside the card. Exists so the three things this card does
// are visibly three things.
function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="flex items-baseline gap-2 mb-2.5 flex-wrap">
        <h3
          className="text-[11px] uppercase font-semibold"
          style={{ letterSpacing: '0.13em', color: 'var(--v7-text-dim)', fontFamily: 'var(--v7-font-mono)' }}
        >
          {title}
        </h3>
        <span className="text-[11.5px]" style={{ color: 'var(--v7-text-mute)' }}>
          {hint}
        </span>
      </div>
      {children}
    </div>
  );
}
