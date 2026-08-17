import { useState } from 'react';
import { completeGate } from '../../lib/enterpriseGate';
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
// Until that exists, the honest screen is this one: state plainly that
// billing is not live, that no card is required and nothing will be charged,
// and let the founder through. See BILLING_NOT_LIVE below — that constant is
// the switch this whole screen hangs off, so wiring Stripe means replacing
// this file, not editing copy around a form.
//
// DO NOT reintroduce a card field here, not even disabled, not even behind a
// feature flag, and not "just for the demo video". The price shown on
// /enterprise/plan is likewise display copy only — when it becomes a real
// charge, the amount must come from the server (a price ID resolved
// server-side), never from a number typed into this bundle, or the client
// gets to name its own price.

export function CheckoutGate() {
  const [, navigate] = useLocation();
  const [continuing, setContinuing] = useState(false);

  const handleContinue = () => {
    setContinuing(true);
    completeGate();
    navigate('/vera');
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-[var(--mint)]/10 border border-[var(--mint)]/30 px-4 py-1.5 rounded-full text-xs font-mono text-[var(--mint)] uppercase tracking-widest mb-6">
            Enterprise Access · Gate 4 of 4
          </div>
          <h1 className="text-3xl font-syne font-extrabold text-white mb-3">Billing isn't live yet</h1>
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
            {continuing ? 'Opening Vera...' : 'Continue to Vera →'}
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
