import { useState } from 'react';
import { saveOnboardingData } from '../../lib/enterpriseGate';
import { useLocation } from 'wouter';
import { GateProgress } from './Signup';
import { useSaveOnboarding } from '../../lib/venusApi';

const ROLES = ['Founder / CEO', 'Co-founder', 'CTO', 'COO', 'Product Lead', 'Other'];
const REFERRAL_SOURCES = ['Twitter / X', 'LinkedIn', 'Friend / Referral', 'Search', 'Product Hunt', 'Investor / Advisor', 'Other'];

export function OnboardingGate() {
  const [, navigate] = useLocation();
  const saveOnboarding = useSaveOnboarding();
  const [form, setForm] = useState({
    companyName: '',
    revenue: '',
    headcount: '',
    role: '',
    roleOther: '',
    referralSource: '',
  });
  const [error, setError] = useState('');

  const effectiveRole = form.role === 'Other' ? form.roleOther : form.role;
  const isValid = form.companyName.trim() && form.role && effectiveRole.trim() && form.referralSource && form.headcount;

  // ---- These answers now reach the server ----
  //
  // THE GAP THIS CLOSES. saveOnboardingData writes to localStorage, and that
  // was the ONLY thing this form did. Five questions asked of every founder
  // before they can use the product — company, revenue, team size, role, and
  // how they heard about Vera — and not one of the answers left the browser.
  // Nobody could have answered "which channel is actually bringing people in"
  // or "what stage are our users at", because the product did not hold it.
  //
  // The local write is KEPT alongside the server write, deliberately: the gate
  // machinery in lib/enterpriseGate.ts reads it synchronously to decide which
  // step comes next, and making that decision wait on a network round trip
  // would put a spinner in the middle of a funnel for no gain.
  //
  // The server write is awaited but never blocking on failure. A founder who
  // has filled in this form has done their part; refusing to let them into the
  // product because our analytics write failed would be punishing them for our
  // problem. The failure is logged, and the nudge engine will notice the
  // profile is still incomplete and ask again later — which is the correct
  // recovery, and it is automatic.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) { setError('Please fill in all required fields.'); return; }

    saveOnboardingData({
      companyName: form.companyName,
      revenue: form.revenue || '0',
      headcount: form.headcount,
      role: effectiveRole,
      referralSource: form.referralSource,
    } as any);

    try {
      await saveOnboarding.mutateAsync({
        companyName: form.companyName.trim(),
        role: effectiveRole.trim(),
        teamSize: form.headcount.trim() || undefined,
        monthlyRevenue: form.revenue.trim() || undefined,
        referralSource: form.referralSource || undefined,
      });
    } catch (err) {
      console.error('[onboarding] could not save profile to the server', err);
    }

    navigate('/enterprise/plan');
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-lg">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-[var(--mint)]/10 border border-[var(--mint)]/30 px-4 py-1.5 rounded-full text-xs font-mono text-[var(--mint)] uppercase tracking-widest mb-6">
            Step 1 of 2
          </div>
          <h1 className="text-3xl font-syne font-extrabold text-white mb-3">Tell Vera About You</h1>
          <p className="text-sm text-[var(--muted)]">Vera calibrates every analysis to your company, stage, and goals.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8 space-y-5">
          {error && (
            <div className="bg-[var(--red)]/10 border border-[var(--red)]/30 text-[var(--red)] text-sm p-3 rounded font-mono">{error}</div>
          )}

          <div>
            <label className="block text-xs font-mono text-[var(--dim)] uppercase tracking-wider mb-2">Company Name <span className="text-[var(--red)]">*</span></label>
            <input
              type="text"
              value={form.companyName}
              onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))}
              placeholder="Acme AI"
              className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text)] placeholder-[var(--dim)] focus:outline-none focus:border-[var(--indigo)] transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-[var(--dim)] uppercase tracking-wider mb-2">Monthly Revenue</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--dim)] text-sm font-mono">$</span>
                <input
                  type="text"
                  value={form.revenue}
                  onChange={e => setForm(f => ({ ...f, revenue: e.target.value }))}
                  placeholder="0 (pre-revenue)"
                  className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg pl-7 pr-4 py-2.5 text-sm text-[var(--text)] placeholder-[var(--dim)] focus:outline-none focus:border-[var(--indigo)] transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-mono text-[var(--dim)] uppercase tracking-wider mb-2">Team Size <span className="text-[var(--red)]">*</span></label>
              <input
                type="number"
                min="1"
                value={form.headcount}
                onChange={e => setForm(f => ({ ...f, headcount: e.target.value }))}
                placeholder="e.g. 12"
                className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text)] placeholder-[var(--dim)] focus:outline-none focus:border-[var(--indigo)] transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono text-[var(--dim)] uppercase tracking-wider mb-2">Your Role <span className="text-[var(--red)]">*</span></label>
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value, roleOther: '' }))}
              className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--indigo)] transition-colors appearance-none"
            >
              <option value="" disabled>Select your role…</option>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {form.role === 'Other' && (
              <input
                type="text"
                value={form.roleOther}
                onChange={e => setForm(f => ({ ...f, roleOther: e.target.value }))}
                placeholder="Enter your role"
                className="mt-2 w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text)] placeholder-[var(--dim)] focus:outline-none focus:border-[var(--indigo)] transition-colors"
              />
            )}
          </div>

          <div>
            <label className="block text-xs font-mono text-[var(--dim)] uppercase tracking-wider mb-2">How did you hear about Vera? <span className="text-[var(--red)]">*</span></label>
            <select
              value={form.referralSource}
              onChange={e => setForm(f => ({ ...f, referralSource: e.target.value }))}
              className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--indigo)] transition-colors appearance-none"
            >
              <option value="" disabled>Select source…</option>
              {REFERRAL_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <button
            type="submit"
            disabled={!isValid}
            className="w-full bg-[var(--indigo)] hover:bg-[var(--indigo-light)] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors text-sm uppercase tracking-wider mt-2"
          >
            Continue to Plan Selection →
          </button>
        </form>

        <GateProgress current={0} />
      </div>
    </div>
  );
}
