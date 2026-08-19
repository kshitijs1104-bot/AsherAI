import { useLocation } from 'wouter';
import { setGateStage, setSelectedTier } from '../../lib/enterpriseGate';
import { GateProgress } from './Signup';
import { useEffect, useState } from 'react';

interface PlanTier {
  key: string;
  name: string;
  priceId: string;
  amount: number;
  currency: string;
  interval: string;
}

function formatAmount(tier: PlanTier): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: tier.currency.toUpperCase(), maximumFractionDigits: 0 }).format(
      tier.amount / 100,
    );
  } catch {
    return `${tier.amount / 100} ${tier.currency.toUpperCase()}`;
  }
}

/* ---------------------------------------------------------------------------
   WHAT THIS SCREEN USED TO CLAIM, AND WHY IT IS GONE.

   This page rendered a three-tier price table ($199/mo Pro, $299/mo Max, one
   marked "Popular") above a ten-row feature comparison. Nine of those ten rows
   described things that do not exist anywhere in the product: a "Decision
   Simulator" with a run count, "Fundraising Intelligence" with investor-fit
   signals and term-sheet benchmarking, a "Competitive Causal Radar" tracking up
   to five competitors, an "Aurelian Forum" with read/post tiers and mentorship
   matching, PDF export, versioned analysis history, custom causal-graph tuning,
   and a priority response queue. There is no code for any of them. Vera's real,
   shipped capability list is enumerated in the api-server's system prompt
   (lib/groq.ts, the "capability" section) and has six entries.

   The tenth row — roadmapping and risk analysis differing by tier — described
   real features with invented limits: the server applies no per-tier limits at
   all, because there is no plan column.

   So this was a feature comparison for a product that does not exist, shown to
   every user during signup, with a "Popular" badge on a plan nobody has ever
   bought. That is the same class of problem as the fabricated testimonials and
   the card-collecting checkout that were both deleted earlier — the exposure
   does not depend on anyone being fooled, and it is worse here because it sits
   in the purchase flow.

   WHAT IT SAYS NOW: everyone is on the free plan by default, and the one
   limit that is real (and enforced per-user in Postgres — see the
   api-server's middlewares/usageLimit.ts) is stated as a number.

   PAID TIERS, WHEN THEY EXIST, FOLLOW THE RULE ABOVE RATHER THAN BREAKING IT.
   The `tiers` state below is empty unless GET /api/billing/plans says
   BILLING_ENABLED is on AND returns tiers — each one's price came from
   stripe.prices.retrieve() on the server (lib/stripe.ts), never a constant
   here. No feature-comparison row exists for them: a paid tier differs from
   free only in what routes/billing.ts and usageLimit.ts actually enforce,
   which today is nothing beyond the checkout itself, so none is claimed.
   Read the header comment in Checkout.tsx for what happens after "Choose".
--------------------------------------------------------------------------- */

// The real usage ceiling, kept in sync with DAILY_CALL_BUDGET / COOLDOWN_MS in
// artifacts/api-server/src/middlewares/usageLimit.ts. If those change, change
// this — a stated limit that does not match the enforced one is how this screen
// got into trouble in the first place.
const INCLUDED: string[] = [
  'Strategic and causal advice on your own business, with full conversation memory',
  'Company file (Dossier) — Vera builds and keeps a working file on your business',
  'Goals, roadmaps and decision logging, with outcomes tracked over time',
  'Business idea review against Vera\'s verified precedent dataset',
  'Company research reports and article summaries',
  'Content drafting — LinkedIn posts, scripts, talking points',
  'Document and image reading — attach a P&L or a screenshot and Vera reads it',
  '250 analyses per day, then a five-hour cooldown',
];

export function PlanGate() {
  const [, navigate] = useLocation();

  // Empty until (if ever) the server says billing is live — see lib/stripe.ts.
  // Nothing here is guessed or hardcoded: both whether paid tiers exist at all
  // and what they cost are read from /api/billing/plans, which itself reads
  // amounts off Stripe's own Price objects. While this stays empty (the
  // correct state for beta users today) the screen below is pixel-identical
  // to what shipped before paid tiers existed.
  const [tiers, setTiers] = useState<PlanTier[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/billing/plans')
      .then((r) => (r.ok ? r.json() : { enabled: false, tiers: [] }))
      .then((data) => {
        if (!cancelled && data?.enabled) setTiers(data.tiers ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Ends at the CONSENT step, not at /vera. Consent was previously a modal that
  // appeared once the founder thought they were finished, which made it read as
  // an obstacle bolted onto the end rather than part of setting up. It is the
  // fourth gate now and is numbered as one. RequireConsent still wraps every
  // route as the backstop for anyone who did not arrive through this funnel —
  // an existing account after a policy version bump, a deep link, a shared URL.
  const handleContinueFree = () => {
    setSelectedTier(null);
    setGateStage('complete');
    navigate('/enterprise/privacy');
  };

  // A paid choice does NOT set gate stage 'complete' here — Checkout does that
  // only after Stripe confirms the payment. Between this click and that
  // confirmation the founder is not yet enterprise-unlocked, which is what
  // stops a paid tier being chosen and Vera opening anyway if they navigate
  // straight to /vera in another tab mid-checkout.
  const handleChoosePaid = (tierKey: string) => {
    setSelectedTier(tierKey);
    navigate('/enterprise/checkout');
  };

  return (
    <div className="min-h-[100dvh] bg-[var(--bg)] flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-[var(--mint)]/10 border border-[var(--mint)]/30 px-4 py-1.5 rounded-full text-xs font-mono text-[var(--mint)] uppercase tracking-widest mb-6">
            Step 3 of 4
          </div>
          <h1 className="text-3xl font-syne font-semibold text-white mb-3">Your Plan</h1>
          <p className="text-sm text-[var(--muted)]">
            Free during beta — ₹999/mo value, on us while we're building this with founders like you.
          </p>
          <p className="text-xs text-[var(--dim)] mt-3">
            No card, no trial clock. If that ever changes, you'll be told before anything's charged.
          </p>
        </div>

        {/* What is actually included. One column, because there is one free plan. */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden mb-8">
          <div className="bg-[var(--surface2)] border-b border-[var(--border)] p-4 flex items-baseline justify-between gap-4">
            <span className="text-xs font-mono text-[var(--dim)] uppercase tracking-wider">Included</span>
            <span className="text-xs font-mono text-[var(--mint)] uppercase tracking-wider">Free during beta</span>
          </div>
          {INCLUDED.map((item, i) => (
            <div
              key={item}
              className={`flex items-start gap-3 p-4 border-b border-[var(--border)] last:border-0 ${
                i % 2 === 0 ? '' : 'bg-[var(--surface2)]/30'
              }`}
            >
              <span className="text-[var(--mint)] text-sm leading-5 shrink-0" aria-hidden="true">
                ✓
              </span>
              <span className="text-xs text-[var(--text)] leading-5">{item}</span>
            </div>
          ))}
        </div>

        <div className="flex justify-center mb-4">
          <button
            onClick={handleContinueFree}
            className="px-12 py-3.5 font-bold text-sm uppercase tracking-wider rounded-lg transition-[transform,opacity,background-color,border-color] bg-[var(--mint)] text-black hover:bg-opacity-90"
          >
            Continue free →
          </button>
        </div>

        {/* Paid tiers — rendered only once the server confirms billing is live
            and returns real, Stripe-backed prices. Empty (today's default)
            means this whole block simply does not render. */}
        {tiers.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 mt-8 mb-4">
            {tiers.map((tier) => (
              <div key={tier.key} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 flex flex-col gap-3">
                <span className="text-xs font-mono text-[var(--dim)] uppercase tracking-wider">{tier.name}</span>
                <span className="text-2xl font-syne font-semibold text-white">
                  {formatAmount(tier)}
                  <span className="text-xs text-[var(--muted)] font-sans"> /{tier.interval}</span>
                </span>
                <button
                  onClick={() => handleChoosePaid(tier.key)}
                  className="mt-2 px-6 py-2.5 font-bold text-xs uppercase tracking-wider rounded-lg border border-[var(--mint)] text-[var(--mint)] hover:bg-[var(--mint)]/10 transition-colors"
                >
                  Choose {tier.name} →
                </button>
              </div>
            ))}
          </div>
        )}

        <GateProgress current={2} />
      </div>
    </div>
  );
}
