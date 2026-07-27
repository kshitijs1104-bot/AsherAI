import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, ListChecks, ThumbsUp, ThumbsDown, Minus, Archive } from 'lucide-react';
import { useDecisions, useArchiveDecision, type VenusDecisionRow, type DecisionFilters } from '../lib/venusApi';
import { VenusThemeToggle } from './VenusThemeToggle';
import { useVenusTheme } from '../lib/venusTheme';

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

function DecisionCard({ decision, onArchive }: { decision: VenusDecisionRow; onArchive: (id: number) => void }) {
  const sentiment = sentimentBadge(decision.outcomeSentiment);

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
    </div>
  );
}

export function DecisionsOverview() {
  const [, navigate] = useLocation();
  const { theme, toggle: toggleTheme } = useVenusTheme();
  const [filter, setFilter] = useState<ViewFilter>('all');
  const isArchivedView = filter === 'archived';

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
            <DecisionCard key={d.id} decision={d} onArchive={(id) => archiveMutation.mutate(id)} />
          ))}
        </div>
      </div>
    </div>
  );
}
