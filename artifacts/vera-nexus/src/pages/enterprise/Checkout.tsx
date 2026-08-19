import { useEffect, useState, type ReactNode } from 'react';
import { completeGate, getSelectedTier, setSelectedTier } from '../../lib/enterpriseGate';
import { useLocation } from 'wouter';
import { GateProgress } from './Signup';

// ---- Why there is no card form on this screen ----
//
// THE BUG THIS CLOSES. This page used to render a full card form —
// cardholder name, PAN, expiry, CVC — under the heading "Secure checkout"
// and a $299/mo price, with a button reading "Subscribe & Unlock Vera".
// Submitting it ran `setTimeout(1800ms)` and then called completeGate().
//
// Nothing was sent anywhere. No Stripe, no PSP, no server call at all. The
// card number lived in React state and was dropped on navigation. The only
// disclosure was one line of 11px grey text BELOW the submit button reading
// "Placeholder checkout — Stripe will be wired before launch", which is
// after the point where a founder has already typed their PAN.
//
// That is not an unfinished feature, it is three distinct liabilities:
//
//   1. It solicits a primary account number and CVC on a page that has no
//      business touching either. The moment a real user types a real card
//      here, this app is handling cardholder data outside PCI DSS scope
//      with no tokenisation, no vault and no processor. The correct amount
//      of card data for an application that does not charge cards is none.
//   2. It says "Secure checkout. Cancel anytime. Access activates instantly"
//      and shows a price, next to a form that charges nothing. A user who
//      completes it reasonably believes they have started a paid
//      subscription. They have not, and there is no record that they tried.
//   3. It is the exact shape of a credential-harvesting page. If it ever
//      leaked into a screenshot, a demo, or a search index, it is
//      indistinguishable from one.
//
// THE FIX is not to make the form "safer" — it is to delete it. Card entry
// belongs to the processor, never to this origin: when billing is real it
// must be Stripe Checkout (a redirect to Stripe's own domain) or Stripe
// Elements (an iframe served by Stripe), so the PAN never enters this app's
// DOM at all. Either way this component's job shrinks to "start a session on
// the server and send the browser there".
//
// UPDATE: Stripe Checkout now exists (routes/billing.ts), and this is what
// wiring it looked like — replacing this file's job, not adding a form to it.
// When a paid tier is chosen on /enterprise/plan, this screen calls
// POST /api/billing/checkout and sends the browser to the URL Stripe returns.
// That URL is Stripe's own hosted page, on Stripe's own domain — the one and
// only place a card number is ever typed. This component never sees it, never
// renders a field for it, and never receives it back. It only receives a
// success or a cancel redirect afterwards.
//
// While billing is off (BILLING_ENABLED unset, or this page reached with no
// tier chosen — a stale link, a bookmark, back-button after billing was
// turned off) the honest screen from before is still what renders: billing
// isn't live, no card needed, continue through.
//
// DO NOT reintroduce a card field here, not even disabled, not even behind a
// feature flag, and not "just for the demo video". The price shown on
// /enterprise/plan is read from Stripe at request time (see lib/stripe.ts) —
// never a number typed into either bundle — and the checkout endpoint
// re-resolves the price server-side from a fixed set of known price ids, so
// the client names which tier, never what it costs.

type Phase = 'not-live' | 'redirecting' | 'confirming' | 'confirmed' | 'error';

export function CheckoutGate() {
  const [, navigate] = useLocation();
  const [continuing, setContinuing] = useState(false);
  const [phase, setPhase] = useState<Phase>('not-live');
  const [errorMessage, setErrorMessage] = useState('');

  const sessionId = new URLSearchParams(window.location.search).get('session_id');
  const tierKey = getSelectedTier();

  useEffect(() => {
    let cancelled = false;

    // Returning from Stripe. This takes priority over starting a new checkout
    // even if a stale tier is still in storage — the browser already has an
    // answer from Stripe, so the job here is to confirm it, not repeat it.
    if (sessionId) {
      setPhase('confirming');
      let attempts = 0;
      const poll = () => {
        fetch('/api/billing/status')
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (cancelled) return;
            if (data?.plan && data.plan !== 'free') {
              setPhase('confirmed');
            } else if (attempts < 5) {
              // The webhook that turns a completed session into a subscription
              // row can land a beat after Stripe redirects the browser back —
              // short poll rather than a hard fail on the founder's first look.
              attempts++;
              setTimeout(poll, 1500);
            } else {
              setPhase('confirmed');
            }
          })
          .catch(() => !cancelled && setPhase('confirmed'));
      };
      poll();
      return () => {
        cancelled = true;
      };
    }

    // A tier was chosen on /enterprise/plan — start a real Stripe Checkout
    // session and leave the app entirely. Nothing renders here for long: this
    // either redirects within a second or drops to the error state below.
    if (tierKey) {
      setPhase('redirecting');
      fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierKey }),
      })
        .then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok || !data.url) throw new Error(data.error || 'Could not start checkout');
          window.location.href = data.url;
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setPhase('error');
          setErrorMessage(err.message);
        });
      return () => {
        cancelled = true;
      };
    }

    // Neither — billing is off, or this was reached with nothing selected
    // (a bookmark, back-button after a free choice). 'not-live' is the
    // default and needs no effect.
    return undefined;
  }, [sessionId, tierKey]);

  const handleContinue = () => {
    setContinuing(true);
    setSelectedTier(null);
    completeGate();
    // Consent is always the last gate, paid or free — see Plan.tsx's
    // handleContinueFree, which this mirrors on purpose.
    navigate('/enterprise/privacy');
  };

  if (phase === 'redirecting') {
    return (
      <GateStatus title="Opening secure payment…" body="Taking you to Stripe's own payment page. Nothing is charged until you complete it there." />
    );
  }

  if (phase === 'confirming') {
    return <GateStatus title="Confirming your payment…" body="This takes a few seconds." />;
  }

  if (phase === 'error') {
    return (
      <GateStatus title="Couldn't start checkout" body={errorMessage || 'Something went wrong — try again.'}>
        <button
          type="button"
          onClick={() => navigate('/enterprise/plan')}
          className="w-full bg-[var(--mint)] text-black font-bold py-3.5 rounded-lg transition-colors text-sm uppercase tracking-wider"
        >
          Back to plans
        </button>
      </GateStatus>
    );
  }

  if (phase === 'confirmed') {
    return (
      <GateStatus title="You're all set" body="Your payment went through — one more step before Vera opens.">
        <button
          type="button"
          onClick={handleContinue}
          disabled={continuing}
          className="w-full bg-[var(--mint)] text-black font-bold py-3.5 rounded-lg transition-colors text-sm uppercase tracking-wider disabled:opacity-70"
        >
          {continuing ? 'Continuing…' : 'Continue →'}
        </button>
      </GateStatus>
    );
  }

  // phase === 'not-live'
  return (
    <div className="min-h-[100dvh] bg-[var(--bg)] flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-[var(--mint)]/10 border border-[var(--mint)]/30 px-4 py-1.5 rounded-full text-xs font-mono text-[var(--mint)] uppercase tracking-widest mb-6">
            Enterprise Access · Gate 4 of 4
          </div>
          <h1 className="text-3xl font-syne font-semibold text-white mb-3">Billing isn't live yet</h1>
          <p className="text-sm text-[var(--muted)]">
            Vera isn't charging for access at this stage. You won't be asked for a card, and nothing will be
            billed to you today.
          </p>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8 space-y-6">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-[var(--mint)] text-sm mt-0.5">✓</span>
              <p className="text-sm text-[var(--text)] leading-relaxed">
                No card details are collected anywhere in this product.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-[var(--mint)] text-sm mt-0.5">✓</span>
              <p className="text-sm text-[var(--text)] leading-relaxed">
                No subscription is created and no payment method is stored.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-[var(--mint)] text-sm mt-0.5">✓</span>
              <p className="text-sm text-[var(--text)] leading-relaxed">
                The plan prices on the previous screen are indicative. When paid plans open, you'll be told
                the price and asked to agree before anything is charged.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleContinue}
            disabled={continuing}
            className="w-full bg-[var(--mint)] text-black font-bold py-3.5 rounded-lg transition-colors text-sm uppercase tracking-wider disabled:opacity-70 flex items-center justify-center gap-2"
          >
            {continuing ? 'Opening Vera…' : 'Continue to Vera →'}
          </button>

          <p className="text-[11px] text-center text-[var(--dim)] font-mono leading-relaxed">
            When billing goes live, card entry will happen on the payment provider's own page — never on this
            one.
          </p>
        </div>
      </div>
    </div>
  );
}

function GateStatus({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[var(--bg)] flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-syne font-semibold text-white mb-3">{title}</h1>
        <p className="text-sm text-[var(--muted)] mb-8">{body}</p>
        {children}
      </div>
    </div>
  );
}
