import { useClerk } from '@clerk/clerk-react';
import { useLocation } from 'wouter';
import { VeraMark } from '../components/VeraMark';

/* ---------------------------------------------------------------------------
   What somebody sees when signup is closed and they are not on the list.

   Shown only when VERA_SIGNUP_MODE=waitlist AND this account has not been
   approved. Existing users never see it — see routes/access.ts for why
   already-onboarded accounts are carved out of the gate rather than being
   locked out the moment it is switched on.

   THE COPY'S ONE JOB IS TO NOT WASTE THEIR TIME. It says the position is real,
   says what happens next, and does not pretend to know when. No fake queue
   number, no "you're #47 in line" — the product has no such number and
   inventing one is exactly the kind of manufactured detail this codebase keeps
   removing. No email-capture form either: they signed up, so the address is
   already on file, and asking again would suggest the first one did not count.
--------------------------------------------------------------------------- */

export function WaitlistGate({ declined }: { declined?: boolean }) {
  const { signOut } = useClerk();
  const [, navigate] = useLocation();

  return (
    <div
      role="status"
      className="min-h-[100dvh] w-full flex items-center justify-center p-6"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="w-full text-center"
        style={{
          maxWidth: 460,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '40px 32px',
        }}
      >
        <div className="flex justify-center mb-5">
          <div
            className="flex items-center justify-center"
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
            }}
          >
            <VeraMark size={26} />
          </div>
        </div>

        {declined ? (
          <>
            <h1 className="font-syne font-semibold mb-3" style={{ fontSize: 22, color: 'var(--text)' }}>
              Asher isn't open to this account
            </h1>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: 'var(--muted)' }}>
              Your account exists, but it doesn't have access right now. If you think that's a mistake,
              reply to your signup email and we'll take another look.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-syne font-semibold mb-3" style={{ fontSize: 22, color: 'var(--text)' }}>
              You're on the list
            </h1>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: 'var(--muted)' }}>
              Asher is closed to new accounts while we work with a small group of founders. Yours is
              recorded — we'll email the address you signed up with when it opens.
            </p>
            <p style={{ margin: '14px 0 0', fontSize: 12.5, lineHeight: 1.6, color: 'var(--dim)' }}>
              We're not going to pretend to know the date. It's a real list, not a form.
            </p>
          </>
        )}

        <button
          type="button"
          onClick={() => signOut(() => navigate('/'))}
          className="mt-7 w-full rounded-lg py-2.5 text-[12.5px] font-semibold transition-colors"
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            color: 'var(--muted)',
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
