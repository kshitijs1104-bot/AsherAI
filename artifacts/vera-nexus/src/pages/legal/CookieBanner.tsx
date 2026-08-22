/* ---------------------------------------------------------------------------
   The cookie choice.

   WHY IT IS A BANNER AND NOT A SECOND FULL-SCREEN GATE. PrivacyGate already
   blocks the entire product until the policy is accepted, and it must stay
   that way. Stacking a second blocking wall in front of a first-time user
   turns "read this" into "click through two things", which is how consent
   screens stop being read at all. This sits at the bottom, does not block, and
   is dismissed only by making a choice — so it cannot be ignored into
   oblivion, but it also is not a toll gate.

   WHY BOTH BUTTONS ARE THE SAME WEIGHT. Under the GDPR (and the ePrivacy rules
   that actually govern cookies) refusing has to be as easy as accepting. A
   prominent "Accept all" beside a grey text link is the dark pattern
   regulators name explicitly. So the two buttons are the same size, the same
   shape, adjacent, and neither is styled as the obvious one. Do not "improve
   conversion" here — this is the part of the screen where that is unlawful,
   not just unkind.

   WHAT IT DOES NOT DO: it does not claim to ask about analytics or advertising
   cookies, because there are none in this app (see cookieConsent.ts). Asking
   consent for tracking that does not exist would be theatre, and it would make
   the one real question — may we keep your preferences on this device —
   invisible inside a list of fictional ones.
--------------------------------------------------------------------------- */

import { useState } from 'react';
import { Link } from 'wouter';
import {
  PREFERENCE_KEYS,
  acceptAllCookies,
  acceptEssentialCookiesOnly,
  useCookieDecided,
} from '../../lib/cookieConsent';

export function CookieBanner() {
  const decided = useCookieDecided();
  const [showDetail, setShowDetail] = useState(false);

  if (decided) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-banner-title"
      className="fixed inset-x-0 bottom-0 z-[70] p-3 sm:p-4"
      style={{ pointerEvents: 'none' }}
    >
      <div
        className="mx-auto w-full bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden"
        style={{ maxWidth: 760, pointerEvents: 'auto' }}
      >
        <div className="px-5 sm:px-6 pt-5 pb-4">
          <h2
            id="cookie-banner-title"
            className="text-sm font-bold text-white mb-2"
          >
            Cookies and what Asher keeps on this device
          </h2>
          <p className="text-[13px] text-[var(--muted)] leading-relaxed">
            Some storage is required for Asher to work at all — staying signed in, remembering that you
            accepted the privacy policy, and a short-lived token used while connecting an account. That part
            has no off switch, because without it there is no product.
          </p>
          <p className="text-[13px] text-[var(--muted)] leading-relaxed mt-2">
            The optional part is your <strong className="text-[var(--text)] font-semibold">preferences</strong>:
            your theme, which panels you left open, and which cards you dismissed. Decline and Asher still
            works exactly the same — it just starts from defaults each time, and anything already saved
            under those is deleted now. Your chats, saved analyses and account are not affected either way.
          </p>
          <p className="text-[13px] text-[var(--muted)] leading-relaxed mt-2">
            There is no advertising or analytics tracking here, and nothing follows you to other sites.
          </p>

          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            aria-expanded={showDetail}
            className="mt-3 text-[12px] font-mono text-[var(--indigo-light)] hover:underline"
          >
            {showDetail ? 'Hide the full list' : `See all ${PREFERENCE_KEYS.length} optional items`}
          </button>

          {showDetail && (
            /* Rendered from the same array the purge iterates, so this list is
               incapable of describing a different set than the one actually
               governed. */
            <ul className="mt-3 border-t border-[var(--border)] pt-3 grid gap-2">
              {PREFERENCE_KEYS.map(({ key, what, prefix }) => (
                <li key={key} className="flex gap-3 items-baseline">
                  <code className="text-[11px] font-mono text-[var(--dim)] shrink-0" style={{ minWidth: 190 }}>
                    {key}
                    {prefix ? '*' : ''}
                  </code>
                  <span className="text-[12px] text-[var(--muted)] leading-relaxed">{what}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 sm:px-6 py-3.5 border-t border-[var(--border)] bg-[var(--surface2)] flex flex-wrap items-center gap-3 justify-between">
          <Link
            href="/privacy"
            className="text-[11px] font-mono text-[var(--dim)] hover:text-[var(--muted)] underline"
          >
            Read the full policy — section 19
          </Link>

          {/* Equal weight, deliberately. See the header comment. */}
          <div className="flex gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={acceptEssentialCookiesOnly}
              className="border border-[var(--border2)] bg-[var(--surface)] hover:bg-[var(--surface3)] text-[var(--text)] font-bold py-2 px-5 rounded-lg transition-colors text-[12px] uppercase tracking-wider"
            >
              Essential only
            </button>
            <button
              type="button"
              onClick={acceptAllCookies}
              className="border border-[var(--border2)] bg-[var(--surface)] hover:bg-[var(--surface3)] text-[var(--text)] font-bold py-2 px-5 rounded-lg transition-colors text-[12px] uppercase tracking-wider"
            >
              Accept all
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
