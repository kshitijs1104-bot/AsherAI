import { useState } from 'react';
import { saveOnboardingData } from '../../lib/enterpriseGate';
import { useLocation } from 'wouter';
import { GateProgress } from './Signup';
import { useSaveOnboarding } from '../../lib/venusApi';
import { setPendingSeedMessage } from '../../lib/venusHistory';

const ROLES = ['Founder / CEO', 'Co-founder', 'CTO', 'COO', 'Product Lead', 'Other'];
const REFERRAL_SOURCES = ['Twitter / X', 'LinkedIn', 'Friend / Referral', 'Search', 'Product Hunt', 'Investor / Advisor', 'Other'];

/* ---- "What brings you here today?" ----
 *
 * Asked FIRST, above everything else, and then actually solved before the
 * founder reaches the home screen — see setPendingSeedMessage in the submit
 * handler. Every other field on this form is something Vera needs; this is the
 * only one that is about what THEY need, which is why it leads.
 *
 * The presets are starting points, not categories. Clicking one fills the box
 * with editable text rather than selecting a value, because the specifics are
 * the entire reason to ask — "churn is climbing" and "churn is climbing since
 * we changed onboarding in March" produce very different first answers, and a
 * radio button can only ever capture the first.
 *
 * Deliberately optional. A founder who does not know yet, or who does not want
 * to say, gets into the product exactly as fast; they simply land on the normal
 * empty chat instead of a seeded one. Making this required would turn the one
 * question asked for their benefit into another toll gate.
 */
const ARRIVAL_PRESETS: string[] = [
  "I'm not sure what's actually driving my numbers",
  'I need to decide something and want it pressure-tested',
  'I want a plan for the next 90 days',
  'Something in the business is stalling and I want to know why',
];

export function OnboardingGate() {
  const [, navigate] = useLocation();
  const saveOnboarding = useSaveOnboarding();
  const [form, setForm] = useState({
    arrivalReason: '',
    companyName: '',
    revenue: '',
    headcount: '',
    role: '',
    roleOther: '',
    referralSource: '',
  });
  const [error, setError] = useState('');
  // Distinct from `error`: that blocks submission, this reports that the submit
  // went through but the durable write did not. Two different things and the
  // founder should not see them worded the same way.
  const [serverWarning, setServerWarning] = useState('');

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

    // Hand the founder's own words forward so Vera opens already working on
    // them, instead of on an empty screen with six generic prompts. Written
    // before the network call and independently of it: the seeded first
    // conversation is the point of asking, and it must not be lost because an
    // analytics write failed.
    if (form.arrivalReason.trim()) {
      setPendingSeedMessage(form.arrivalReason);
    }

    try {
      await saveOnboarding.mutateAsync({
        companyName: form.companyName.trim(),
        role: effectiveRole.trim(),
        teamSize: form.headcount.trim() || undefined,
        monthlyRevenue: form.revenue.trim() || undefined,
        referralSource: form.referralSource || undefined,
        arrivalReason: form.arrivalReason.trim() || undefined,
      });
    } catch (err) {
      // NOT silent any more, and that changed because of what silence cost.
      //
      // This was console.error only, on the theory that a founder who filled in
      // the form should not be blocked by our analytics write. That part still
      // holds — they continue to the next step either way. But swallowing it
      // entirely meant a failing write was invisible from BOTH sides: the
      // founder saw a successful submit, and the server never recorded them as
      // onboarded, so the "tell Vera who you are" nudge kept firing at somebody
      // who had just done exactly that. Reported live as precisely that loop.
      //
      // Now it is stated plainly, they carry on regardless, and the nudge no
      // longer depends on this write succeeding (see hasToldVeraWhoTheyAre in
      // the api-server's lib/nudges.ts).
      console.error('[onboarding] could not save profile to the server', err);
      setServerWarning(
        err instanceof Error
          ? `Vera couldn't save this to its server — ${err.message}`
          : "Vera couldn't save this to its server.",
      );
      // Stops here rather than navigating on. Setting a warning and then
      // immediately leaving the page would show it to nobody, and carrying on
      // silently is what produced the reported loop: the founder believes they
      // are set up, the server has no record, and the "tell Vera who you are"
      // nudge follows them around forever. They can still continue — the button
      // below the warning does exactly that — but now it is their decision and
      // they know what it costs.
      return;
    }

    navigate('/enterprise/plan');
  };

  // Escape hatch for the failure above. Their answers are already in local
  // storage, so the funnel works; what they lose is Vera reasoning from this
  // on the server, and the account card will show it as missing.
  const continueAnyway = () => navigate('/enterprise/plan');

  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-lg">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-[var(--mint)]/10 border border-[var(--mint)]/30 px-4 py-1.5 rounded-full text-xs font-mono text-[var(--mint)] uppercase tracking-widest mb-6">
            Step 2 of 4
          </div>
          <h1 className="text-3xl font-syne font-extrabold text-white mb-3">Tell Vera About You</h1>
          <p className="text-sm text-[var(--muted)]">Vera calibrates every analysis to your company, stage, and goals.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8 space-y-5">
          {error && (
            <div className="bg-[var(--red)]/10 border border-[var(--red)]/30 text-[var(--red)] text-sm p-3 rounded font-mono">{error}</div>
          )}

          {serverWarning && (
            <div className="bg-[var(--red)]/10 border border-[var(--red)]/30 rounded p-3">
              <p className="text-[var(--red)] text-xs leading-relaxed m-0">{serverWarning}</p>
              <p className="text-[var(--muted)] text-[11px] leading-relaxed mt-1.5 mb-2">
                Your answers are saved on this device. Try again, or carry on — Vera just won't be able
                to use them until this saves.
              </p>
              <button
                type="button"
                onClick={continueAnyway}
                className="text-[11px] font-semibold text-[var(--muted)] underline underline-offset-2"
              >
                Continue anyway →
              </button>
            </div>
          )}

          {/* Leads the form. Everything below this is something Vera needs;
              this is the only question about what the FOUNDER needs, and it is
              answered before they reach the home screen. */}
          <div className="pb-5 mb-1 border-b border-[var(--border)]">
            <label className="block text-xs font-mono text-[var(--dim)] uppercase tracking-wider mb-2">
              What brings you here today?
            </label>
            <textarea
              value={form.arrivalReason}
              onChange={e => setForm(f => ({ ...f, arrivalReason: e.target.value }))}
              rows={2}
              placeholder="The thing you actually want help with. Vera starts on it right away."
              className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text)] placeholder-[var(--dim)] focus:outline-none focus:border-[var(--indigo)] transition-colors resize-none"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {ARRIVAL_PRESETS.map(preset => (
                <button
                  key={preset}
                  type="button"
                  // Fills the box rather than selecting a value — the founder
                  // can then make it specific, which is what makes the first
                  // answer good.
                  onClick={() => setForm(f => ({ ...f, arrivalReason: preset }))}
                  className="text-[11px] px-2.5 py-1 rounded-full border transition-colors"
                  style={{
                    borderColor: form.arrivalReason === preset ? 'var(--indigo)' : 'var(--border)',
                    color: form.arrivalReason === preset ? 'var(--text)' : 'var(--muted)',
                    background: form.arrivalReason === preset ? 'var(--indigo)' + '20' : 'transparent',
                  }}
                >
                  {preset}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--dim)] mt-2 leading-relaxed">
              Optional — skip it and you'll land on a normal blank chat.
            </p>
          </div>

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

        <GateProgress current={1} />
      </div>
    </div>
  );
}
