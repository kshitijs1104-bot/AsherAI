import { useLocation } from 'wouter';
import { setGateStage } from '../../lib/enterpriseGate';
import { GateProgress } from './Signup';
import { useState } from 'react';

type Tier = 'free' | 'pro' | 'max';

const FEATURES: { label: string; free: string | boolean; pro: string | boolean; max: string | boolean }[] = [
  { label: 'Roadmapping horizon', free: '2 weeks', pro: '6 months', max: '18 months + quarterly checkpoints' },
  { label: 'Risk analysis', free: 'Top-line pattern match only', pro: 'Full analysis + recommended fixes', max: 'Step-by-step remediation plans' },
  { label: 'Decision Simulator', free: '3 runs total', pro: 'Unlimited runs', max: 'Unlimited runs' },
  { label: 'Failure Pattern Matching', free: 'Top 3 precedents', pro: 'Full 100-company database', max: 'Full database + versioned history' },
  { label: 'Fundraising Intelligence', free: false, pro: 'Investor-fit signals + timing', max: 'Warm-intro suggestions + term sheet benchmarking' },
  { label: 'Competitive Causal Radar', free: false, pro: 'Track up to 5 competitors', max: 'Unlimited + real-time shift alerts' },
  { label: 'Aurelian Forum', free: 'Read-only', pro: 'Full read + post access', max: 'Priority mentorship matching' },
  { label: 'Save & export analyses', free: false, pro: 'PDF / share link', max: 'Versioned history (compare v1 vs v2)' },
  { label: 'Custom causal graph tuning', free: false, pro: false, max: true },
  { label: 'Response priority', free: 'Standard', pro: 'Standard', max: 'Priority queue' },
];

function Cell({ value }: { value: string | boolean }) {
  if (value === false) return <span className="text-[var(--dim)] text-lg">–</span>;
  if (value === true) return <span className="text-[var(--mint)]">✓</span>;
  return <span className="text-xs text-[var(--muted)] leading-tight">{value}</span>;
}

export function PlanGate() {
  const [, navigate] = useLocation();
  const [selected, setSelected] = useState<Tier>('pro');

  const handleContinue = () => {
    setGateStage(selected === 'free' ? 'complete' : 'plan');
    if (selected === 'free') {
      navigate('/vera');
    } else {
      navigate('/enterprise/checkout');
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-[var(--mint)]/10 border border-[var(--mint)]/30 px-4 py-1.5 rounded-full text-xs font-mono text-[var(--mint)] uppercase tracking-widest mb-6">
            Enterprise Access · Gate 3 of 4
          </div>
          <h1 className="text-3xl font-syne font-extrabold text-white mb-3">Choose Your Plan</h1>
          <p className="text-sm text-[var(--muted)]">All plans start with Vera's full intelligence engine. Limits apply based on tier.</p>
        </div>

        {/* Tier selector cards */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {([
            { id: 'free', label: 'Free Trial', price: '1 week', sub: 'No credit card required', color: 'var(--dim)', recommended: false },
            { id: 'pro', label: 'Pro', price: '$199', sub: 'per month · cancel anytime', color: 'var(--indigo)', recommended: false },
            { id: 'max', label: 'Max', price: '$299', sub: 'per month · cancel anytime', color: 'var(--mint)', recommended: true },
          ] as const).map(tier => (
            <button
              key={tier.id}
              onClick={() => setSelected(tier.id)}
              className={`relative p-5 rounded-xl border text-left transition-all ${
                selected === tier.id
                  ? tier.id === 'max'
                    ? 'border-[var(--mint)] bg-[var(--mint)]/5 shadow-[0_0_30px_rgba(0,229,176,0.08)]'
                    : tier.id === 'pro'
                    ? 'border-[var(--indigo)] bg-[var(--indigo)]/5'
                    : 'border-[var(--border2)] bg-[var(--surface2)]'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border2)]'
              }`}
            >
              {tier.recommended && (
                <div className="absolute top-3 right-3 bg-[var(--mint)] text-black text-[9px] font-bold uppercase px-2 py-0.5 rounded tracking-wider">
                  Popular
                </div>
              )}
              <div className="text-xs font-mono uppercase tracking-wider mb-2" style={{ color: tier.color }}>
                {tier.label}
              </div>
              <div className="text-2xl font-syne font-extrabold text-white mb-0.5">{tier.price}</div>
              <div className="text-[10px] font-mono text-[var(--dim)]">{tier.sub}</div>
            </button>
          ))}
        </div>

        {/* Feature comparison table */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden mb-8">
          <div className="grid grid-cols-4 bg-[var(--surface2)] border-b border-[var(--border)]">
            <div className="p-4 text-xs font-mono text-[var(--dim)] uppercase tracking-wider">Feature</div>
            <div className="p-4 text-xs font-mono text-[var(--dim)] uppercase tracking-wider text-center">Free</div>
            <div className="p-4 text-xs font-mono text-[var(--indigo-light)] uppercase tracking-wider text-center">Pro</div>
            <div className="p-4 text-xs font-mono text-[var(--mint)] uppercase tracking-wider text-center">Max</div>
          </div>
          {FEATURES.map((f, i) => (
            <div
              key={f.label}
              className={`grid grid-cols-4 border-b border-[var(--border)] last:border-0 ${i % 2 === 0 ? '' : 'bg-[var(--surface2)]/30'}`}
            >
              <div className="p-4 text-xs text-[var(--text)]">{f.label}</div>
              <div className="p-4 text-center"><Cell value={f.free} /></div>
              <div className="p-4 text-center"><Cell value={f.pro} /></div>
              <div className="p-4 text-center"><Cell value={f.max} /></div>
            </div>
          ))}
        </div>

        <div className="flex justify-center">
          <button
            onClick={handleContinue}
            className={`px-12 py-3.5 font-bold text-sm uppercase tracking-wider rounded-lg transition-all ${
              selected === 'max'
                ? 'bg-[var(--mint)] text-black hover:bg-opacity-90'
                : selected === 'pro'
                ? 'bg-[var(--indigo)] text-white hover:bg-[var(--indigo-light)]'
                : 'bg-[var(--surface2)] border border-[var(--border2)] text-white hover:bg-[var(--surface3)]'
            }`}
          >
            {selected === 'free' ? 'Start Free Trial →' : `Continue with ${selected === 'pro' ? 'Pro' : 'Max'} →`}
          </button>
        </div>

        <GateProgress current={2} />
      </div>
    </div>
  );
}
