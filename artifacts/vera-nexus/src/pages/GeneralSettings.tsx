import { useState } from 'react';
import { useClerk } from '@clerk/clerk-react';
import { useLocation } from 'wouter';
import { FileText, Trash2, ExternalLink, Cookie } from 'lucide-react';
import { useDeleteAccount } from '../lib/venusApi';
import { acceptAllCookies, acceptEssentialCookiesOnly, usePreferenceStorageAllowed } from '../lib/cookieConsent';

/* ---------------------------------------------------------------------------
   The "General" tab of VeraSettingsModal.

   Two things live here today: a link to the Privacy Policy, and account
   deletion. Both exist because the alternative was that they didn't — the
   privacy policy has no in-app link a signed-in founder could actually reach
   (the standalone /settings page that used to carry one is dead code, wired
   to nothing in the live router — see Settings.tsx), and DELETE /api/account
   existed on the server with no UI in front of it at all.

   Add future account-level toggles here (the personalization/training
   opt-out proposed in LAUNCH_CHECKLIST.md item 9, when it's built, belongs in
   this tab) — this is "settings about the account", as distinct from
   Connectors (external integrations) and Appearance (visual skin).
--------------------------------------------------------------------------- */

function PrivacyLinkRow() {
  return (
    <a
      href="/privacy"
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors"
      style={{ background: 'var(--v7-bg-raised-2)', color: 'var(--v7-text-dim)' }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--v7-text)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--v7-text-dim)')}
    >
      <FileText className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1">Privacy Policy &amp; Terms</span>
      <ExternalLink className="w-3 h-3 shrink-0" style={{ color: 'var(--v7-text-mute)' }} />
    </a>
  );
}

// ---- The opt-out for preference storage ----
//
// There is no cookie banner (see CONSENT_REQUIRED in lib/cookieConsent.ts —
// nothing Vera stores requires consent), so this row is not the back-door to a
// banner decision. It is the whole control, and that is why it stays: "we
// don't have to ask" is a reason to skip the interruption, not a reason to
// leave someone with no way to say no. Section 19 of the policy points here.
//
// Storage is ON by default in this mode. Switching it off DELETES what was
// stored rather than just recording the change — acceptEssentialCookiesOnly
// purges. Switching it back on only permits future writes; it cannot restore
// what was already cleared, which is why the copy says "from now on" rather
// than implying anything comes back.
function CookieChoiceRow() {
  const allowed = usePreferenceStorageAllowed();

  return (
    <div
      className="px-3 py-2.5 rounded-lg"
      style={{ background: 'var(--v7-bg-raised-2)' }}
    >
      <div className="flex items-center gap-2.5">
        <Cookie className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--v7-text-mute)' }} />
        <span className="flex-1 text-[13px] font-medium" style={{ color: 'var(--v7-text-dim)' }}>
          Store preferences on this device
        </span>
        <button
          type="button"
          onClick={allowed ? acceptEssentialCookiesOnly : acceptAllCookies}
          className="text-[11.5px] font-semibold px-2.5 py-1.5 rounded-md shrink-0"
          style={{ background: 'var(--v7-bg-raised-3, rgba(255,255,255,0.06))', color: 'var(--v7-text)' }}
        >
          {allowed ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      <p className="text-[11.5px] leading-relaxed mt-1.5" style={{ color: 'var(--v7-text-mute)' }}>
        {allowed
          ? 'Your theme, panel layout and dismissed cards are remembered between visits. Turning this off deletes them now and stops Asher saving them again.'
          : 'Asher is not saving your theme, panel layout or dismissed cards, so it starts from defaults each visit. Turning this on saves them from now on. Your chats and saved analyses are unaffected either way.'}
      </p>
    </div>
  );
}

// Text that must be typed exactly to enable the final button. A second click
// on an already-visible "delete" button is not a deliberate act — people
// double-click things, and a modal's default focus can land on a button that
// gets confirmed by a stray Enter key. Typing a specific word is the bar that
// actually filters those out, for the one action here with no undo.
const CONFIRM_WORD = 'DELETE';

function DeleteAccountSection() {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [, navigate] = useLocation();
  const { signOut } = useClerk();
  const deleteAccount = useDeleteAccount();

  const reset = () => {
    setConfirming(false);
    setTyped('');
    deleteAccount.reset();
  };

  const handleConfirm = () => {
    if (typed !== CONFIRM_WORD) return;
    deleteAccount.mutate(undefined, {
      onSuccess: () => {
        // The server has already deleted the underlying Clerk user by the
        // time this resolves (see account.ts) — this signOut() call is what
        // clears the SPA's own belief that a session still exists, so
        // RequireAuth in App.tsx sends the now-signed-out browser to the
        // landing page instead of leaving a dead session in memory until
        // Clerk's own token refresh eventually notices.
        signOut(() => navigate('/'));
      },
    });
  };

  if (!confirming) {
    return (
      <div
        className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium"
        style={{ background: 'var(--v7-bg-raised-2)' }}
      >
        <Trash2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--red, #e5555c)' }} />
        <span className="flex-1" style={{ color: 'var(--v7-text-dim)' }}>
          Delete account
        </span>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-[11.5px] font-semibold px-2.5 py-1.5 rounded-md shrink-0"
          style={{ background: 'rgba(229,85,92,0.12)', border: '1px solid rgba(229,85,92,0.35)', color: 'var(--red, #e5555c)' }}
        >
          Delete…
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-3.5" style={{ background: 'var(--v7-bg-raised-2)', border: '1px solid rgba(229,85,92,0.35)' }}>
      <div className="text-[12.5px] font-semibold mb-1.5" style={{ color: 'var(--red, #e5555c)' }}>
        This permanently deletes your account
      </div>
      <p className="text-[11.5px] leading-relaxed mb-2.5" style={{ color: 'var(--v7-text-mute)' }}>
        Every chat and message, every uploaded file, your business profile, everything Asher has
        learned about your company, your connected accounts, your workflows and your settings.
        This cannot be undone.
      </p>

      <label className="block text-[10.5px] font-mono uppercase tracking-wider mb-1" style={{ color: 'var(--v7-text-mute)' }}>
        Type {CONFIRM_WORD} to confirm
      </label>
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={CONFIRM_WORD}
        autoFocus
        className="w-full text-[12px] rounded-md px-2 py-1.5 mb-2.5 outline-none"
        style={{
          background: 'var(--v7-bg-raised)',
          color: 'var(--v7-text)',
          border: '1px solid rgba(229,85,92,0.35)',
        }}
      />

      {deleteAccount.isError && (
        <div className="text-[11px] mb-2" style={{ color: 'var(--red, #e5555c)' }}>
          {deleteAccount.error instanceof Error ? deleteAccount.error.message : 'Something went wrong — try again.'}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={typed !== CONFIRM_WORD || deleteAccount.isPending}
          onClick={handleConfirm}
          className="text-[11.5px] font-semibold px-2.5 py-1.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--red-fill, #DC2626)', color: '#fff' }}
        >
          {deleteAccount.isPending ? 'Deleting…' : 'Permanently delete my account'}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={deleteAccount.isPending}
          className="text-[11.5px]"
          style={{ color: 'var(--v7-text-mute)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function GeneralSettings() {
  return (
    <div className="flex flex-col gap-2">
      <PrivacyLinkRow />
      <CookieChoiceRow />
      <div style={{ height: 1, background: 'var(--v7-border)', margin: '4px 0' }} />
      <div
        className="text-[10px] font-mono uppercase tracking-wider mb-0.5"
        style={{ color: 'var(--v7-text-mute)' }}
      >
        Danger zone
      </div>
      <DeleteAccountSection />
    </div>
  );
}
