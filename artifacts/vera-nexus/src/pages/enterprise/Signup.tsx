/* ---------------------------------------------------------------------------
   THE SIGN-UP FORM THAT USED TO LIVE HERE IS GONE.

   `SignupGate` rendered a name + work-email form, wrote both to localStorage,
   and moved the visitor to onboarding. It had not been reachable for some time:
   `/enterprise/signup` routes to `SignupEntry` in App.tsx, which hands the
   visitor to Clerk's real sign-up. So this was a second, fake front door with
   no account behind it — it collected an email nobody read and produced a
   "signed up" state that no server had heard of.

   Deleting it rather than leaving it unrouted, for the same reason the backend
   deleted its six dead routers: a screen no live path reaches cannot be tested
   by using the product, so it drifts away from the real one and eventually
   somebody wires it back up by accident.

   Real sign-up is Clerk's. It owns the password, the verification email, the
   reset flow, the lockout and the enumeration defences — none of which this
   codebase should be reimplementing on a form that stored its results in a
   browser.
--------------------------------------------------------------------------- */

// ---- The step indicator, telling the truth about how many steps there are ----
//
// This used to render "Gate 1 / Gate 2 / Gate 3 / Gate 4" on every screen in
// the funnel. Three separate things were wrong with that:
//
//   Gate 1 was this file's deleted form, so the first pip pointed at a step
//   that no longer exists — a founder arriving from Clerk landed on "Gate 2"
//   with no way to know what they had supposedly already done.
//
//   Gate 4 was checkout, which is no longer in the funnel at all (billing
//   isn't live; see Plan.tsx). It advertised a payment step that never comes.
//
//   "Gate" is the product's internal word for it. Nobody signing up thinks of
//   themselves as passing through gates, and the word reads as an obstacle
//   course — the opposite of what a two-step setup should feel like.
//
// What remains is what actually exists: tell Vera about your company, then
// start. Two steps, named as themselves.
const STEPS = ['Your company', 'Start using Vera'] as const;

export function GateProgress({ current }: { current: number }) {
  return (
    <nav aria-label="Setup progress" className="flex justify-center items-center gap-2 mt-8">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center gap-2">
            <span
              aria-current={active ? 'step' : undefined}
              className={`text-[10px] font-mono px-2.5 py-1 rounded transition-colors ${
                active
                  ? 'bg-[var(--indigo)] text-white'
                  : done
                    ? 'bg-[var(--mint)]/15 text-[var(--mint)] border border-[var(--mint)]/30'
                    : 'bg-[var(--surface)] text-[var(--dim)] border border-[var(--border)]'
              }`}
            >
              {done ? '✓ ' : ''}
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <span aria-hidden="true" className="w-4 h-px" style={{ background: 'var(--border)' }} />
            )}
          </div>
        );
      })}
    </nav>
  );
}
