import { useState } from 'react';
import { completeGate } from '../../lib/enterpriseGate';
import { useLocation } from 'wouter';
import { GateProgress } from './Signup';

export function CheckoutGate() {
  const [, navigate] = useLocation();
  const [processing, setProcessing] = useState(false);
  const [card, setCard] = useState({ number: '', expiry: '', cvc: '', name: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    setTimeout(() => {
      completeGate();
      navigate('/vera');
    }, 1800);
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-[var(--mint)]/10 border border-[var(--mint)]/30 px-4 py-1.5 rounded-full text-xs font-mono text-[var(--mint)] uppercase tracking-widest mb-6">
            Enterprise Access · Gate 4 of 4
          </div>
          <h1 className="text-3xl font-syne font-extrabold text-white mb-3">Subscribe to Vera</h1>
          <p className="text-sm text-[var(--muted)]">Secure checkout. Cancel anytime. Access activates instantly.</p>
        </div>

        <div className="bg-[var(--surface2)] border border-[var(--border)] rounded-xl p-4 mb-6 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-white">Vera · Max Plan</div>
            <div className="text-xs text-[var(--muted)] font-mono">Unlimited · 18-month roadmaps · Priority queue</div>
          </div>
          <div className="text-2xl font-syne font-extrabold text-[var(--mint)]">$299<span className="text-sm font-normal text-[var(--muted)]">/mo</span></div>
        </div>

        <form onSubmit={handleSubmit} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8 space-y-5">
          <div>
            <label className="block text-xs font-mono text-[var(--dim)] uppercase tracking-wider mb-2">Cardholder Name</label>
            <input
              type="text"
              value={card.name}
              onChange={e => setCard(c => ({ ...c, name: e.target.value }))}
              placeholder="Jane Smith"
              className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm text-[var(--text)] placeholder-[var(--dim)] focus:outline-none focus:border-[var(--indigo)] transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-[var(--dim)] uppercase tracking-wider mb-2">Card Number</label>
            <input
              type="text"
              value={card.number}
              onChange={e => setCard(c => ({ ...c, number: e.target.value }))}
              placeholder="4242 4242 4242 4242"
              maxLength={19}
              className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm text-[var(--text)] placeholder-[var(--dim)] focus:outline-none focus:border-[var(--indigo)] transition-colors font-mono"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-[var(--dim)] uppercase tracking-wider mb-2">Expiry</label>
              <input
                type="text"
                value={card.expiry}
                onChange={e => setCard(c => ({ ...c, expiry: e.target.value }))}
                placeholder="MM / YY"
                maxLength={7}
                className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm text-[var(--text)] placeholder-[var(--dim)] focus:outline-none focus:border-[var(--indigo)] transition-colors font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-[var(--dim)] uppercase tracking-wider mb-2">CVC</label>
              <input
                type="text"
                value={card.cvc}
                onChange={e => setCard(c => ({ ...c, cvc: e.target.value }))}
                placeholder="123"
                maxLength={4}
                className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm text-[var(--text)] placeholder-[var(--dim)] focus:outline-none focus:border-[var(--indigo)] transition-colors font-mono"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={processing}
            className="w-full bg-[var(--mint)] text-black font-bold py-3.5 rounded-lg transition-colors text-sm uppercase tracking-wider disabled:opacity-70 flex items-center justify-center gap-2 mt-2"
          >
            {processing ? (
              <>
                <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin"></div>
                Activating Access...
              </>
            ) : (
              'Subscribe & Unlock Vera →'
            )}
          </button>

          <p className="text-[11px] text-center text-[var(--dim)] font-mono">
            Placeholder checkout — Stripe will be wired before launch.
          </p>
        </form>

        <GateProgress current={3} />
      </div>
    </div>
  );
}
