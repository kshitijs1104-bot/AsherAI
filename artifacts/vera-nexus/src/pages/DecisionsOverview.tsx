import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ListChecks, ThumbsUp, ThumbsDown, Minus, Archive, MessageSquare, PenLine } from 'lucide-react';
import { useDecisions, useArchiveDecision, type VenusDecisionRow, type DecisionFilters } from '../lib/venusApi';
import { reportSubTaskOutcome, type OutcomeSentiment } from './GoalPanel';
import { VenusThemeToggle } from './VenusThemeToggle';
import { useVenusTheme } from '../lib/venusTheme';
import { OPEN_CHAT_KEY } from '../lib/venusHistory';

// The browse surface Decision Memory never had — the backend has logged and
// resolved decisions since the Goal feature shipped (see venus_decisions.ts),
// but the only place they were ever visible was as sub-tasks inside a
// goaled chat's GoalPanel. This is every decision Venus has logged for the
// founder, independent of any one chat or goal.
type ViewFilter = DecisionFilters['status'] | 'all' | 'archived';

// "Archived" sits in the SAME row as the status filters rather than a
// separate lone toggle off to the side — the original design (a
// right-aligned "Show archived" button) was easy to miss entirely, which is
// exactly the "where did my archived decisions even go" confusion this
// replaces.
const STATUS_FILTERS: { value: ViewFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'abandoned', label: 'Abandoned' },
  { value: 'archived', label: 'Archived' },
];

function sentimentBadge(sentiment: VenusDecisionRow['outcomeSentiment']) {
  if (sentiment === 'positive') return { Icon: ThumbsUp, color: 'var(--v7-cyan)', label: 'Worked' };
  if (sentiment === 'negative') return { Icon: ThumbsDown, color: 'var(--red, #e5555c)', label: "Didn't work" };
  if (sentiment === 'mixed') return { Icon: Minus, color: 'var(--amber, #d9a441)', label: 'Mixed' };
  return null;
}

const SENTIMENT_OPTIONS: { value: OutcomeSentiment; label: string; Icon: typeof ThumbsUp; color: string }[] = [
  { value: 'positive', label: 'Worked', Icon: ThumbsUp, color: 'var(--v7-cyan)' },
  { value: 'mixed', label: 'Mixed', Icon: Minus, color: 'var(--amber, #d9a441)' },
  { value: 'negative', label: "Didn't work", Icon: ThumbsDown, color: 'var(--red, #e5555c)' },
];

/**
 * Inline outcome capture. Posts to the same endpoint GoalPanel's sub-task
 * reporter uses — decisions and goal sub-tasks are rows in the same table,
 * so there is one write path and one place for it to be wrong.
 */
function OutcomeForm({ decisionId, onSaved }: { decisionId: number; onSaved: () => void }) {
  const [sentiment, setSentiment] = useState<OutcomeSentiment | null>(null);
  const [outcome, setOutcome] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = sentiment && outcome.trim() && !submitting;

  const submit = async () => {
    if (!canSubmit || !sentiment) return;
    setSubmitting(true);
    setError(null);
    try {
      await reportSubTaskOutcome(decisionId, outcome.trim(), sentiment);
      onSaved();
    } catch {
      setError('Failed to save — try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--v7-border, rgba(255,255,255,0.08))' }}>
      <div className="flex gap-1.5 mb-2 flex-wrap">
        {SENTIMENT_OPTIONS.map(({ value, label, Icon, color }) => {
          const active = sentiment === value;
          return (
            <button
              key={value}
              onClick={() => setSentiment(value)}
              className="flex items-center gap-1.5 text-[11.5px] font-medium px-2.5 py-1.5 rounded-lg transition-colors"
              style={{
                color: active ? color : 'var(--v7-text-mute)',
                background: active ? `${color}1a` : 'transparent',
                border: `1px solid ${active ? color : 'var(--v7-border, rgba(255,255,255,0.1))'}`,
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
          autoFocus
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="What actually happened? (one line)"
          className="flex-1 min-w-0 text-[12.5px] rounded-lg px-3 py-2 outline-none"
          style={{ background: 'var(--v7-bg-raised-2)', border: '1px solid var(--v7-border, rgba(255,255,255,0.1))', color: 'var(--v7-text)' }}
        />
        <button
          disabled={!canSubmit}
          onClick={submit}
          className="shrink-0 text-[11.5px] font-semibold px-3 py-2 rounded-lg disabled:opacity-40"
          style={{ background: 'var(--v7-cyan-soft)', color: 'var(--v7-cyan)' }}
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <div className="text-[11.5px] mt-1.5" style={{ color: 'var(--red, #e5555c)' }}>{error}</div>}
    </div>
  );
}

function DecisionCard({ decision, onArchive, onOpenChat, onSaved }: {
  decision: VenusDecisionRow;
  onArchive: (id: number) => void;
  onOpenChat?: (chatId: number) => void;
  onSaved: () => void;
}) {
  const sentiment = sentimentBadge(decision.outcomeSentiment);
  const [logging, setLogging] = useState(false);

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-border, rgba(255,255,255,0.08))' }}
    >
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span
            className="text-[9.5px] font-mono uppercase px-1.5 py-0.5 rounded"
            style={{ background: 'var(--v7-bg-raised-2)', color: 'var(--v7-text-mute)' }}
          >
            {decision.cardType}
          </span>
          {decision.decisionType && (
            <span
              className="text-[9.5px] font-mono uppercase px-1.5 py-0.5 rounded"
              style={{ background: 'var(--v7-bg-raised-2)', color: 'var(--v7-cyan)' }}
            >
              {decision.decisionType}
            </span>
          )}
          {decision.reinforcedCount > 1 && (
            <span className="text-[9.5px] font-mono" style={{ color: 'var(--v7-text-mute)' }}>
              asked {decision.reinforcedCount}×
            </span>
          )}
        </div>
        {!decision.archived && (
          <button
            onClick={() => onArchive(decision.id)}
            title="Archive"
            className="shrink-0"
            style={{ color: 'var(--v7-text-mute)' }}
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="text-[13px] font-semibold mb-1" style={{ color: 'var(--v7-text)' }}>{decision.query}</div>
      <div className="text-[12px] mb-2" style={{ color: 'var(--v7-text-dim)' }}>{decision.recommendationSummary}</div>

      {decision.status === 'resolved' ? (
        <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--v7-border, rgba(255,255,255,0.08))' }}>
          {sentiment && (
            <div className="flex items-center gap-1 text-[11px] mb-1" style={{ color: sentiment.color }}>
              <sentiment.Icon className="w-3 h-3" />
              {sentiment.label}
            </div>
          )}
          {decision.lesson && (
            <div className="text-[12px]" style={{ color: 'var(--v7-text-dim)' }}>{decision.lesson}</div>
          )}
        </div>
      ) : (
        <div className="text-[11px] font-mono uppercase" style={{ color: 'var(--v7-text-mute)' }}>{decision.status}</div>
      )}

      {/* This page listed decisions and offered nothing to do with them —
          no way back to the conversation the decision came out of, and no
          way to say how it turned out. Both are added here: the chat link
          because a decision without its reasoning is just a sentence, and
          the outcome because an unresolved decision is the only thing that
          moves the goal's evidence score (see GoalPanel). */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {decision.chatId != null && onOpenChat && (
          <button
            onClick={() => onOpenChat(decision.chatId!)}
            className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors"
            style={{ background: 'var(--v7-cyan-soft)', color: 'var(--v7-cyan)' }}
          >
            <MessageSquare className="w-3 h-3" />
            Open chat
          </button>
        )}
        {decision.status === 'open' && !logging && (
          <button
            onClick={() => setLogging(true)}
            className="inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2.5 py-1.5 rounded-lg transition-colors"
            style={{ border: '1px solid var(--v7-border, rgba(255,255,255,0.12))', color: 'var(--v7-text-dim)' }}
          >
            <PenLine className="w-3 h-3" />
            How did it go?
          </button>
        )}
      </div>

      {logging && <OutcomeForm decisionId={decision.id} onSaved={() => { setLogging(false); onSaved(); }} />}
    </div>
  );
}

export function DecisionsOverview() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { theme, toggle: toggleTheme } = useVenusTheme();
  const [filter, setFilter] = useState<ViewFilter>('all');
  const isArchivedView = filter === 'archived';

  // This page is its own route, so it can't reach into Venus's session state
  // directly. It leaves the chat id where Venus looks for it on mount and
  // navigates — a one-shot handoff, cleared by the reader (see OPEN_CHAT_KEY).
  const openChat = (chatId: number) => {
    try {
      localStorage.setItem(OPEN_CHAT_KEY, String(chatId));
    } catch {
      // No localStorage — the founder lands on Vera's usual chat instead of
      // the specific one, which is a degraded jump rather than a broken one.
    }
    navigate('/vera');
  };

  const { data, isLoading } = useDecisions({
    status: isArchivedView || filter === 'all' ? undefined : filter,
    includeArchived: isArchivedView,
  });
  const archiveMutation = useArchiveDecision();
  // The API's includeArchived flag widens the result set rather than
  // isolating it (archived rows join the normal ones, not replace them) —
  // this is what actually makes "Archived" a clean, exclusive view.
  const decisions = (data?.decisions ?? []).filter((d) => (isArchivedView ? d.archived : !d.archived));

  return (
    <div className={`min-h-screen w-full ${theme === 'light' ? 'v7-light' : ''}`} style={{ background: 'var(--v7-bg)', color: 'var(--v7-text)', fontFamily: 'var(--v7-font-round)' }}>
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate('/vera')}
            className="flex items-center gap-1.5 text-[13px] font-medium"
            style={{ color: 'var(--v7-text-mute)' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Vera
          </button>
          <VenusThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>

        <div className="flex items-center gap-2 mb-1">
          <ListChecks className="w-4 h-4" style={{ color: 'var(--v7-cyan)' }} />
          <h1 className="text-[19px] font-extrabold">Decisions</h1>
        </div>
        <p className="text-[13px] mb-5" style={{ color: 'var(--v7-text-mute)' }}>
          Everything Vera has recommended, and what happened when you acted on it.
        </p>

        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {STATUS_FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className="text-[11px] font-medium px-2.5 py-1 rounded-md"
                style={{
                  color: active ? 'var(--v7-cyan)' : 'var(--v7-text-mute)',
                  background: active ? 'var(--v7-cyan-soft)' : 'transparent',
                  border: `1px solid ${active ? 'var(--v7-cyan-strong)' : 'var(--v7-border, rgba(255,255,255,0.08))'}`,
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {isLoading && <div className="text-[13px] mt-4" style={{ color: 'var(--v7-text-mute)' }}>Loading…</div>}

        {!isLoading && decisions.length === 0 && (
          <div className="text-[13px] rounded-xl p-4 mt-4" style={{ background: 'var(--v7-bg-raised)', color: 'var(--v7-text-mute)' }}>
            {isArchivedView
              ? "Nothing archived yet — the archive icon on any decision moves it here without deleting it."
              : 'Nothing here yet — a decision or roadmap card Vera gives you in any chat gets logged here automatically.'}
          </div>
        )}

        <div className="space-y-2.5 mt-4">
          {decisions.map((d) => (
            <DecisionCard
              key={d.id}
              decision={d}
              onArchive={(id) => archiveMutation.mutate(id)}
              onOpenChat={openChat}
              onSaved={() => queryClient.invalidateQueries({ queryKey: ['/api/ai/decisions'] })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
