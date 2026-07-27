import { useLocation } from 'wouter';
import { ArrowLeft, Target, TrendingUp, AlertTriangle } from 'lucide-react';
import { useGoals, type GoalWithChat } from '../lib/venusApi';
import { VenusThemeToggle } from './VenusThemeToggle';
import { useVenusTheme } from '../lib/venusTheme';

// Goals stay scoped 1:1 to a chat by design (see goals.ts on the backend —
// each chat is its own "project," the way a Claude Project's custom
// instructions frame one thread). This page doesn't change that; it's just
// the founder-level read a per-chat GoalPanel can't give: every live goal
// across every project, at a glance.
function formatInr(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

function riskLabel(risk: GoalWithChat['risk']): { label: string; color: string; Icon: typeof TrendingUp } {
  if (risk === 'on_track') return { label: 'On track', color: 'var(--v7-cyan)', Icon: TrendingUp };
  if (risk === 'at_risk') return { label: 'At risk', color: 'var(--amber, #d9a441)', Icon: AlertTriangle };
  return { label: 'Off track', color: 'var(--red, #e5555c)', Icon: AlertTriangle };
}

function goalPercent(goal: GoalWithChat): number {
  const clamped = Math.max(0, Math.min(1, goal.position));
  if (clamped <= 0) return 0;
  return Math.max(1, Math.min(100, Math.floor(clamped * 100)));
}

function GoalRow({ goal }: { goal: GoalWithChat }) {
  const { label, color, Icon } = riskLabel(goal.risk);
  const pct = goalPercent(goal);
  const rawPct = goal.position * 100;
  const clampedPct = rawPct <= 0 ? 0 : Math.max(2, Math.min(98, rawPct));

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-border, rgba(255,255,255,0.08))' }}
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <div className="text-[10.5px] font-mono uppercase tracking-wider mb-0.5" style={{ color: 'var(--v7-text-mute)' }}>
            {goal.chatTitle}
          </div>
          <div className="text-[14px] font-bold truncate" style={{ color: 'var(--v7-text)' }}>{goal.title}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[13px] font-mono font-bold" style={{ color }}>{pct}%</div>
          <div className="flex items-center gap-1 text-[10.5px]" style={{ color }}>
            <Icon className="w-3 h-3" />
            {label}
          </div>
        </div>
      </div>

      <div className="relative rounded-full mt-2" style={{ height: 6, background: 'var(--v7-bg-raised-2)' }}>
        <div
          className="absolute top-0 left-0 h-full rounded-full"
          style={{ width: `${clampedPct}%`, background: color, opacity: 0.35 }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full border-2"
          style={{ width: 12, height: 12, left: `calc(${clampedPct}% - ${rawPct <= 0 ? 0 : 6}px)`, background: 'var(--v7-bg)', borderColor: color }}
        />
      </div>

      <div className="flex items-center justify-between mt-2 text-[11px]" style={{ color: 'var(--v7-text-mute)' }}>
        <span className="truncate max-w-[60%]">{goal.successMetric}</span>
        <span>{formatInr(goal.valueInr)} · due {new Date(goal.deadline).toLocaleDateString()}</span>
      </div>

      {goal.status !== 'active' && (
        <div className="text-[10.5px] font-mono uppercase mt-2" style={{ color: 'var(--v7-text-mute)' }}>{goal.status}</div>
      )}
    </div>
  );
}

export function GoalsOverview() {
  const [, navigate] = useLocation();
  const { theme, toggle: toggleTheme } = useVenusTheme();
  const { data, isLoading } = useGoals();
  const goals = data?.goals ?? [];
  const active = goals.filter((g) => g.status === 'active');
  const resolved = goals.filter((g) => g.status !== 'active');

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
          <Target className="w-4 h-4" style={{ color: 'var(--v7-cyan)' }} />
          <h1 className="text-[19px] font-extrabold">Goals</h1>
        </div>
        <p className="text-[13px] mb-6" style={{ color: 'var(--v7-text-mute)' }}>
          Every live goal across every chat, in one place. Set or edit a goal from inside its chat.
        </p>

        {isLoading && <div className="text-[13px]" style={{ color: 'var(--v7-text-mute)' }}>Loading…</div>}

        {!isLoading && goals.length === 0 && (
          <div className="text-[13px] rounded-xl p-4" style={{ background: 'var(--v7-bg-raised)', color: 'var(--v7-text-mute)' }}>
            No goals set yet. Open a chat and set one — Vera will weigh urgency, value, and trade-offs against it in every answer there.
          </div>
        )}

        {active.length > 0 && (
          <div className="space-y-2.5 mb-6">
            {active.map((g) => <GoalRow key={g.id} goal={g} />)}
          </div>
        )}

        {resolved.length > 0 && (
          <div>
            <div className="text-[10.5px] font-mono uppercase tracking-wider mb-2" style={{ color: 'var(--v7-text-mute)' }}>
              Resolved
            </div>
            <div className="space-y-2.5">
              {resolved.map((g) => <GoalRow key={g.id} goal={g} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
