import { useState } from 'react';
import { Link } from 'wouter';
import {
  useAccessState,
  useOperatorWhoami,
  useOperatorUsers,
  useAccessRequests,
  useDecideAccessRequest,
  useSetAccountSuspended,
  type AccessRequestRow,
  type OperatorUserRow,
} from '../lib/venusApi';

/* ---------------------------------------------------------------------------
   THE DEV/OPERATOR CONSOLE — one page, two controls, no devtools.

   WHAT THIS PAGE IS FOR. Letting a specific person in, and taking access away
   from a specific person. Those are the only two things a founder actually
   needs to do to Vera's user list day to day, and before this page existed
   both were done by pasting a fetch() into devtools. Everything else the
   operator API can do (the audit trail, per-account activity, usage) stays
   deliberately UI-less — see routes/operator.ts's header for that argument.

   NOT LINKED FROM ANYWHERE LIVE, same precedent as pages/Settings.tsx —
   reachable at /enterprise/access by typing the URL. An operator-only screen
   in the main nav is a screen every future non-operator founder also sees and
   wonders about; a direct URL costs nothing and is exactly as reachable for
   the one person who needs it.

   ---- THE FAILURE THIS REWRITE FIXES ----

   EVERY ACTION ON THE OLD PAGE FAILED SILENTLY. `decide.mutate(...)` was
   called and its result was never looked at: no `isError`, no `error.message`,
   no confirmation. React Query catches the rejection, so a refused write
   produced NOTHING — the button un-greyed and the row sat there unchanged.

   That is not a cosmetic gap, it is the whole "the whitelist doesn't work"
   report. A grant can be refused for reasons that have nothing to do with the
   email typed: a 403 from the CSRF origin check when ALLOWED_ORIGIN doesn't
   match the browser's origin (writes fail while reads keep working, so the
   page looks perfectly healthy), a 404 because this account isn't in
   OPERATOR_USER_IDS, a 500 because the access_requests migration hasn't been
   applied to this database. In all three the operator saw the same thing they
   saw on success: nothing. They told the person they were approved. The person
   said it still didn't work. Both concluded the feature was broken.

   So: every mutation on this page renders its outcome, success and failure,
   in the operator's own words. A write that did not happen must never look
   like one that did.

   THE SECOND HALF is showing which address the server actually matched on.
   The other way a whitelist silently "doesn't work" is approving a different
   address from the one Clerk holds for that person — a work alias instead of
   the Google account they really signed in with. Nothing about that is
   visible from either end. The identity strip at the top prints it.
--------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------
 * Shared bits
 * ---------------------------------------------------------------------- */

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--indigo)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function formatStamp(ms: number | null): string {
  return ms ? formatDate(new Date(ms).toISOString()) : '—';
}

/** The one component this page could not do without: an outcome, always
 *  rendered, in both directions. `role="status"` so it is announced rather
 *  than only seen. */
function Outcome({ error, success }: { error?: unknown; success?: string | null }) {
  const message = error instanceof Error ? error.message : error ? String(error) : null;
  if (!message && !success) return null;

  const bad = Boolean(message);
  const color = bad ? 'var(--red)' : 'var(--green)';

  return (
    <p
      role="status"
      aria-live="polite"
      className="mt-3 text-[12.5px] leading-relaxed rounded-lg px-3 py-2"
      style={{ color, background: `${bad ? 'rgba(239,68,68' : 'rgba(34,197,94'},0.10)`, border: `1px solid ${color}40` }}
    >
      {message ?? success}
    </p>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 sm:p-8">
      <h2 className="text-[17px] font-syne font-bold text-[var(--text)] mb-1">{title}</h2>
      {hint && <p className="text-xs text-[var(--muted)] mb-5 leading-relaxed">{hint}</p>}
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Who you are, and what the gate is currently doing
 * ---------------------------------------------------------------------- */

// Printed before anything else because both values are things the operator
// otherwise has to infer from behaviour. "Signup is open" in particular means
// nothing below this line restricts anybody — approving emails all afternoon
// while the mode is open is work that changes nothing, and it looked exactly
// like work that did.
function IdentityStrip() {
  const access = useAccessState();
  const waitlist = access.data?.mode === 'waitlist';

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-3">
      <div className="min-w-0">
        <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--dim)] mb-1">Signed in as</div>
        <div className="text-[13px] text-[var(--text)] truncate">{access.data?.email ?? '—'}</div>
      </div>
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--dim)] mb-1">Signup mode</div>
        <div className="text-[13px] flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: waitlist ? 'var(--amber)' : 'var(--green)' }}
          />
          <span style={{ color: waitlist ? 'var(--amber)' : 'var(--green)' }}>
            {waitlist ? 'Waitlist' : 'Open'}
          </span>
          <span className="text-[var(--dim)]">
            {waitlist ? '— only approved emails get in' : '— anyone can sign up'}
          </span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Letting someone in
 * ---------------------------------------------------------------------- */

/** Paste-an-email form — the "share with" box. Also the way to let someone in
 *  before they've signed up: decide/upsert doesn't need a pending row. */
function GrantAccessForm() {
  const [email, setEmail] = useState('');
  const [granted, setGranted] = useState<string | null>(null);
  const decide = useDecideAccessRequest();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setGranted(null);
    decide.mutate(
      { email: trimmed, decision: 'approve' },
      {
        onSuccess: (result) => {
          setGranted(result.email);
          setEmail('');
        },
      },
    );
  };

  return (
    <>
      <form onSubmit={submit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="someone@example.com"
          aria-label="Email address to approve"
          className={`flex-1 bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text)] placeholder-[var(--dim)] transition-colors ${focusRing}`}
        />
        <button
          type="submit"
          disabled={decide.isPending || !email.trim()}
          className={`bg-white text-black hover:bg-gray-200 disabled:opacity-40 font-bold uppercase text-xs tracking-wider px-5 py-2.5 rounded-lg transition-colors whitespace-nowrap ${focusRing}`}
        >
          {decide.isPending ? 'Granting…' : 'Grant access'}
        </button>
      </form>
      <Outcome
        error={decide.error}
        success={
          granted
            ? `${granted} is approved. They get in on their next sign-in — if their tab is already open, they may need to reload.`
            : null
        }
      />
    </>
  );
}

/** One row's Approve/Decline buttons — always offers the action that isn't
 *  the current status, so a decision already made can be flipped. */
function RowActions({ row }: { row: AccessRequestRow }) {
  const decide = useDecideAccessRequest();
  const busy = decide.isPending;

  return (
    <div className="flex flex-col items-end gap-1.5 shrink-0">
      <div className="flex items-center gap-2">
        {row.status !== 'approved' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => decide.mutate({ email: row.email, decision: 'approve' })}
            className={`text-[11px] font-semibold px-3 py-1.5 rounded bg-[var(--v7-cyan)] text-black disabled:opacity-40 transition-opacity ${focusRing}`}
          >
            Approve
          </button>
        )}
        {row.status !== 'declined' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => decide.mutate({ email: row.email, decision: 'decline' })}
            className={`text-[11px] font-semibold px-3 py-1.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40 transition-colors ${focusRing}`}
          >
            Decline
          </button>
        )}
      </div>
      {/* Per row, because a failure that scrolls to the top of the page is a
          failure attached to the wrong record. */}
      {decide.isError && (
        <span className="text-[11px] text-[var(--red)] max-w-[220px] text-right leading-snug">
          {decide.error instanceof Error ? decide.error.message : 'That change did not save.'}
        </span>
      )}
    </div>
  );
}

const STATUS_STYLE: Record<AccessRequestRow['status'], { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'var(--amber)' },
  approved: { label: 'Approved', color: 'var(--v7-cyan)' },
  declined: { label: 'Declined', color: 'var(--red)' },
};

function StatusBadge({ status }: { status: AccessRequestRow['status'] }) {
  const s = STATUS_STYLE[status] ?? { label: status, color: 'var(--dim)' };
  return (
    <span
      className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded"
      style={{ color: s.color, background: `${s.color}1a`, border: `1px solid ${s.color}4d` }}
    >
      {s.label}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Taking access away
 * ---------------------------------------------------------------------- */

// Suspension, not decline — see the note on useSetAccountSuspended for why
// those are different controls. Decline only decides what happens at the front
// door; suspension is checked on every authenticated request and is the one
// that actually stops somebody who is already inside.
function RevokeRow({ user }: { user: OperatorUserRow }) {
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const set = useSetAccountSuspended();
  const suspended = user.veraStatus === 'suspended';

  const apply = () => {
    setDone(null);
    set.mutate(
      { userId: user.userId, suspend: !suspended, reason: reason.trim() },
      {
        onSuccess: () => {
          setDone(suspended ? 'Access restored.' : 'Access revoked — it takes effect within about ten seconds.');
          setReason('');
        },
      },
    );
  };

  return (
    <li className="bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-3.5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-[var(--text)] truncate">{user.email ?? '(no email on file)'}</span>
            <span
              className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded"
              style={
                suspended
                  ? { color: 'var(--red)', background: 'rgba(239,68,68,0.10)', border: '1px solid var(--red)' }
                  : { color: 'var(--green)', background: 'rgba(34,197,94,0.10)', border: '1px solid #22c55e4d' }
              }
            >
              {suspended ? 'Suspended' : 'Active'}
            </span>
            {user.clerkBanned && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--dim)]">Banned in Clerk</span>
            )}
          </div>
          <p className="text-[11px] text-[var(--dim)] mt-1 font-mono truncate">{user.userId}</p>
          <p className="text-[11px] text-[var(--dim)] mt-0.5">
            Last signed in {formatStamp(user.lastSignInAt)}
            {user.veraStatusReason ? ` · ${user.veraStatusReason}` : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mt-3">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={suspended ? 'Why are you restoring this account?' : 'Why are you revoking this account?'}
          aria-label="Reason"
          className={`flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] text-[var(--text)] placeholder-[var(--dim)] transition-colors ${focusRing}`}
        />
        <button
          type="button"
          // The server requires ten characters and rejects anything shorter.
          // Mirrored here so the requirement reads as a rule rather than as a
          // rejection, but the server remains the one enforcing it.
          disabled={set.isPending || reason.trim().length < 10}
          onClick={apply}
          className={`text-[11px] font-semibold uppercase tracking-wider px-4 py-2 rounded-lg transition-colors whitespace-nowrap disabled:opacity-40 ${focusRing} ${
            suspended
              ? 'bg-[var(--v7-cyan)] text-black'
              : 'border border-[var(--red)] text-[var(--red)] hover:bg-[rgba(239,68,68,0.10)]'
          }`}
        >
          {set.isPending ? 'Saving…' : suspended ? 'Restore access' : 'Revoke access'}
        </button>
      </div>

      {reason.trim().length > 0 && reason.trim().length < 10 && (
        <p className="text-[11px] text-[var(--dim)] mt-2">
          Give a real reason — at least 10 characters. This is the record you'll read in three months.
        </p>
      )}

      <Outcome error={set.error} success={done} />
    </li>
  );
}

function RevokeSection() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const users = useOperatorUsers(submitted, true);

  return (
    <Section
      title="Revoke access"
      hint={
        <>
          Suspending stops an account using Vera on the next request — every route at once, not just the sign-in
          screen. Declining someone in the list above only affects people who don't have access yet. Leave the box
          empty to see the most recent signups.
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query.trim());
        }}
        className="flex flex-col sm:flex-row gap-3 mb-5"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by email or name"
          aria-label="Search accounts"
          className={`flex-1 bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text)] placeholder-[var(--dim)] transition-colors ${focusRing}`}
        />
        <button
          type="submit"
          className={`border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] font-bold uppercase text-xs tracking-wider px-5 py-2.5 rounded-lg transition-colors ${focusRing}`}
        >
          Search
        </button>
      </form>

      {users.isLoading && <p className="text-sm text-[var(--muted)]">Looking…</p>}
      <Outcome error={users.error} />
      {users.data && users.data.users.length === 0 && (
        <p className="text-sm text-[var(--muted)]">No account matched that.</p>
      )}

      <ul className="space-y-2">
        {users.data?.users.map((u) => (
          <RevokeRow key={u.userId} user={u} />
        ))}
      </ul>
    </Section>
  );
}

/* -------------------------------------------------------------------------
 * Not an operator
 * ---------------------------------------------------------------------- */

function NotAnOperator() {
  return (
    <Section title="You're not recognised as an operator">
      <p className="text-sm text-[var(--muted)] mb-4 leading-relaxed">
        This account isn't in <code className="text-[var(--text)]">OPERATOR_USER_IDS</code> — or the api-server
        hasn't restarted since it was set. Two things to check:
      </p>
      <ol className="text-sm text-[var(--muted)] space-y-2 list-decimal list-inside leading-relaxed">
        <li>
          Open the api-server's Repl → <span className="text-[var(--text)]">Tools → Secrets</span> → confirm{' '}
          <code className="text-[var(--text)]">OPERATOR_USER_IDS</code> contains this account's Clerk user id
          (starts with <code className="text-[var(--text)]">user_</code>, not an email) — get the exact value from{' '}
          <a
            href="https://dashboard.clerk.com"
            target="_blank"
            rel="noreferrer"
            className={`underline underline-offset-2 text-[var(--text)] rounded ${focusRing}`}
          >
            dashboard.clerk.com
          </a>{' '}
          → Users → your account.
        </li>
        <li>Restart the api-server — it only reads that Secret at boot.</li>
      </ol>
    </Section>
  );
}

/* -------------------------------------------------------------------------
 * The page
 * ---------------------------------------------------------------------- */

export function AccessRequestsPage() {
  const whoami = useOperatorWhoami();
  const requests = useAccessRequests();

  return (
    <div className="dark min-h-[100dvh] bg-[var(--bg)] text-[var(--text)]">
      <div className="p-6 sm:p-8 max-w-3xl mx-auto space-y-6">
        <Link
          href="/vera"
          className={`inline-flex items-center gap-2 text-[13px] text-[var(--muted)] hover:text-[var(--text)] transition-colors rounded ${focusRing}`}
        >
          <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" aria-hidden>
            <path d="M15 5L8 12L15 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Vera
        </Link>

        <header>
          <h1 className="text-2xl font-syne font-bold text-[var(--text)] mb-1.5">Access</h1>
          <p className="text-sm text-[var(--muted)]">Who can use Vera, and who can't.</p>
        </header>

        <IdentityStrip />

        {whoami.isLoading && <p className="text-sm text-[var(--muted)]">Checking operator access…</p>}

        {whoami.isError && <NotAnOperator />}

        {whoami.data && (
          <>
            <Section
              title="Grant access"
              hint="Same idea as sharing a Drive folder — paste an email and it's approved, whether or not they've signed up yet."
            >
              <GrantAccessForm />
            </Section>

            <Section title="Everyone who's asked, or been granted access">
              {requests.isLoading && <p className="text-sm text-[var(--muted)]">Loading…</p>}
              <Outcome error={requests.error} />
              {requests.data && requests.data.requests.length === 0 && (
                <p className="text-sm text-[var(--muted)]">Nobody yet.</p>
              )}

              <ul className="space-y-2">
                {requests.data?.requests.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-start justify-between gap-4 bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-[var(--text)] truncate">{row.email}</span>
                        <StatusBadge status={row.status} />
                      </div>
                      <p className="text-[11px] text-[var(--dim)] mt-0.5">
                        {[row.name, row.company].filter(Boolean).join(' · ') || 'No name on file'} — requested{' '}
                        {formatDate(row.requestedAt)}
                        {row.claimedAt ? ` · signed in ${formatDate(row.claimedAt)}` : ''}
                      </p>
                    </div>
                    <RowActions row={row} />
                  </li>
                ))}
              </ul>
            </Section>

            <RevokeSection />

            <p className="text-[11px] text-[var(--dim)] leading-relaxed">
              Signup mode is set by <code>VERA_SIGNUP_MODE</code> on the api-server (a Secret, not a control on this
              page): <code>waitlist</code> closes signup, anything else leaves it open. It's read at boot, so restart
              after changing it. Operators and anyone who has already finished onboarding are never gated.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
