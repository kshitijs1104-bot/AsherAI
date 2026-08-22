import { useState } from 'react';
import { Link } from 'wouter';
import {
  useOperatorWhoami,
  useAccessRequests,
  useDecideAccessRequest,
  type AccessRequestRow,
} from '../lib/venusApi';

/* ---------------------------------------------------------------------------
   The UI the operator surface never had — see routes/operator.ts's header
   comment, which argues deliberately for no UI on THAT surface (suspend,
   audit trail, usage). This page is narrower on purpose: it only ever calls
   the two access-requests endpoints (list, decide), never anything
   destructive, so it doesn't carry the same reasoning against having a
   screen. What it replaces is an operator pasting a fetch() call into
   devtools every time they want to let one more email in.

   NOT LINKED FROM ANYWHERE LIVE, same precedent as pages/Settings.tsx —
   reachable at /enterprise/access by typing the URL. An operator-only screen
   in the main nav is a screen every future non-operator founder also sees and
   wonders about; a direct URL costs nothing and is exactly as reachable for
   the one person who needs it.

   Every request here 404s for a non-operator rather than 403ing (see
   requireOperator in middlewares/auth.ts), so "not an operator" and "the
   server is unreachable" are told apart by whether whoami loaded at all
   rather than by status code alone.
--------------------------------------------------------------------------- */

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

const STATUS_STYLE: Record<AccessRequestRow['status'], { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'var(--amber, #d9a441)' },
  approved: { label: 'Approved', color: 'var(--v7-cyan, #4fd1c5)' },
  declined: { label: "Declined", color: 'var(--red, #e5555c)' },
};

function StatusBadge({ status }: { status: AccessRequestRow['status'] }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded"
      style={{ color: s.color, background: `${s.color}1a`, border: `1px solid ${s.color}4d` }}
    >
      {s.label}
    </span>
  );
}

/** One row's Approve/Decline buttons — always offers the action that isn't
 *  the current status, so a decision already made can be flipped. */
function RowActions({ row }: { row: AccessRequestRow }) {
  const decide = useDecideAccessRequest();
  const busy = decide.isPending && decide.variables?.email === row.email;

  return (
    <div className="flex items-center gap-2 shrink-0">
      {row.status !== 'approved' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => decide.mutate({ email: row.email, decision: 'approve' })}
          className="text-[11px] font-semibold px-3 py-1.5 rounded bg-[var(--v7-cyan,#4fd1c5)] text-black disabled:opacity-40 transition-opacity"
        >
          Approve
        </button>
      )}
      {row.status !== 'declined' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => decide.mutate({ email: row.email, decision: 'decline' })}
          className="text-[11px] font-semibold px-3 py-1.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-white disabled:opacity-40 transition-colors"
        >
          Decline
        </button>
      )}
    </div>
  );
}

/** Paste-an-email form — this is the "share with" box. Also the way to let
 *  someone in before they've signed up: decide/upsert doesn't require a
 *  pending row to already exist. */
function GrantAccessForm() {
  const [email, setEmail] = useState('');
  const decide = useDecideAccessRequest();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    decide.mutate(
      { email: trimmed, decision: 'approve' },
      { onSuccess: () => setEmail('') },
    );
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-3">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="someone@example.com"
        className="flex-1 bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-white placeholder-[var(--dim)] focus:outline-none focus:border-[var(--indigo)] transition-colors"
      />
      <button
        type="submit"
        disabled={decide.isPending || !email.trim()}
        className="bg-white text-black hover:bg-gray-200 disabled:opacity-40 font-bold uppercase text-xs tracking-wider px-5 py-2.5 rounded transition-colors whitespace-nowrap"
      >
        {decide.isPending ? 'Granting…' : 'Grant Access'}
      </button>
    </form>
  );
}

function NotAnOperator() {
  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8">
      <h2 className="text-lg font-syne font-bold text-white mb-2">You're not recognized as an operator</h2>
      <p className="text-sm text-[var(--muted)] mb-4">
        This account isn't in <code className="text-white">OPERATOR_USER_IDS</code> — or the api-server hasn't
        restarted since it was set. Two things to check:
      </p>
      <ol className="text-sm text-[var(--muted)] space-y-2 list-decimal list-inside">
        <li>
          Open the api-server's Repl → <span className="text-white">Tools → Secrets</span> → confirm{' '}
          <code className="text-white">OPERATOR_USER_IDS</code> contains this account's Clerk user id (starts with{' '}
          <code className="text-white">user_</code>, not an email) — get the exact value from{' '}
          <a
            href="https://dashboard.clerk.com"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 text-white"
          >
            dashboard.clerk.com
          </a>{' '}
          → Users → your account.
        </li>
        <li>Restart the api-server — it only reads that Secret at boot.</li>
      </ol>
    </section>
  );
}

export function AccessRequestsPage() {
  const whoami = useOperatorWhoami();
  const requests = useAccessRequests();

  return (
    <div className="dark min-h-[100dvh] bg-[var(--bg)] text-[var(--text)]">
      <div className="p-8 max-w-3xl mx-auto space-y-8">
        <Link
          href="/vera"
          className="inline-flex items-center gap-2 text-[13px] text-[var(--muted)] hover:text-white transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5">
            <path d="M15 5L8 12L15 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Asher
        </Link>

        <header>
          <h1 className="text-2xl font-syne font-bold text-white mb-2">Access Requests</h1>
          <p className="text-sm font-mono text-[var(--muted)]">Approve or decline who's allowed to sign up.</p>
        </header>

        {whoami.isLoading && <p className="text-sm text-[var(--muted)]">Checking operator access…</p>}

        {whoami.isError && <NotAnOperator />}

        {whoami.data && (
          <>
            <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8">
              <h2 className="text-lg font-syne font-bold text-white mb-1">Signup mode</h2>
              <p className="text-xs text-[var(--muted)] mb-4">
                {requests.data?.mode === 'waitlist'
                  ? 'Waitlist — only approved emails below get in. Everyone else sees a waiting-room screen.'
                  : "Open — anyone can sign up right now. Nothing below actually restricts anyone until this is switched to waitlist mode."}
              </p>
              <p className="text-[11px] text-[var(--dim)]">
                This is set by <code>VERA_SIGNUP_MODE</code> (a Secret on the api-server, not a control on this
                page) — set it to <code>waitlist</code> and restart to turn it on.
              </p>
            </section>

            <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8">
              <h2 className="text-lg font-syne font-bold text-white mb-1">Grant access</h2>
              <p className="text-xs text-[var(--muted)] mb-6">
                Same idea as sharing a Drive folder — paste an email and it's approved, whether or not they've
                signed up yet.
              </p>
              <GrantAccessForm />
            </section>

            <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8">
              <h2 className="text-lg font-syne font-bold text-white mb-4">Everyone who's asked, or been granted access</h2>

              {requests.isLoading && <p className="text-sm text-[var(--muted)]">Loading…</p>}
              {requests.data && requests.data.requests.length === 0 && (
                <p className="text-sm text-[var(--muted)]">Nobody yet.</p>
              )}

              <ul className="space-y-2">
                {requests.data?.requests.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center justify-between gap-4 bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-white truncate">{row.email}</span>
                        <StatusBadge status={row.status} />
                      </div>
                      <p className="text-[11px] text-[var(--dim)] mt-0.5">
                        {[row.name, row.company].filter(Boolean).join(' · ') || 'No name on file'} — requested{' '}
                        {formatDate(row.requestedAt)}
                      </p>
                    </div>
                    <RowActions row={row} />
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
