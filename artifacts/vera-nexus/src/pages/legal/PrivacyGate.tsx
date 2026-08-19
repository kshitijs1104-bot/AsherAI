/* ---------------------------------------------------------------------------
   The first thing a new account sees.

   Mounted inside RequireAuth in App.tsx, ABOVE the router's inner Switch, so
   it is not a step in the enterprise funnel — it is a condition on the whole
   product. A signed-in visitor who has not accepted the current policy sees
   this and nothing else, whichever URL they arrived at: fresh signup, a
   bookmarked /vera/dossier, a shared link. There is no path around it, which
   is the entire point of putting it here instead of at /enterprise/privacy.

   No dismiss, no escape key, no click-outside. The SkinPicker next to it in the
   mount order can be dismissed because a visual preference is a real choice to
   defer. Consent is not: if it can be skipped, some fraction of users are using
   the product without having agreed to anything while the record says otherwise.

   THIS DOES NOT GATE THE BUTTON ON SCROLLING TO THE END, and it does not offer
   a paraphrased shortcut either — earlier versions tried both (a "read to the
   bottom" requirement, then a six-line "in plain terms" summary with jump links
   into the document) and both were removed. The scroll gate produced nothing
   more than a scrollbar drag; the summary and jump links were a second,
   shorter version of the terms living next to the real one, which is exactly
   the kind of divergence risk this file's own design principle warns against.
   What is here instead: the actual document, and a plain, honest checkbox. The
   checkbox starts unticked, so agreeing is a deliberate action rather than a
   byproduct of wanting to get to the app.
--------------------------------------------------------------------------- */

import { useState } from 'react';
import { acceptPrivacy } from '../../lib/privacyConsent';
import { ADDITIONAL_SECTIONS, OWNERSHIP_SECTIONS, POLICY_META, PolicyProse } from './privacyPolicy';

// Takes no props and returns nothing: acceptPrivacy() writes the record and
// notifies the store behind usePrivacyAccepted, so whoever is gating on that —
// RequireConsent, and the SkinPicker beside it — re-renders on its own. An
// onAccept callback would be a second, redundant path to the same state change,
// and the two could disagree.
export function PrivacyGate() {
  const [agreed, setAgreed] = useState(false);

  const accept = () => {
    if (!agreed) return;
    acceptPrivacy();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-gate-title"
      className="min-h-[100dvh] bg-[var(--bg)] flex items-center justify-center p-3 sm:p-6"
    >
      <div
        className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden flex flex-col"
        style={{ maxWidth: 720, maxHeight: 'min(94vh, 980px)' }}
      >
        {/* Header — outside the scroll area so what this is stays on screen
            while the text moves under it. Kept deliberately short: every line
            here is a line taken off the reading pane below. */}
        <div className="px-6 sm:px-8 pt-6 pb-4 border-b border-[var(--border)]">
          <div className="inline-flex items-center gap-2 bg-[var(--mint)]/10 border border-[var(--mint)]/30 px-3 py-1 rounded-full text-[10px] font-mono text-[var(--mint)] uppercase tracking-widest mb-3">
            Before you start
          </div>
          <h1
            id="privacy-gate-title"
            className="text-xl sm:text-2xl font-syne font-semibold text-white mb-1.5"
          >
            What Vera does with your data
          </h1>
          <p className="text-[13px] text-[var(--muted)] leading-relaxed">
            Vera works by remembering your business, so it holds a great deal about it. Read this
            before you type anything into it.{' '}
            <span className="text-[var(--dim)] font-mono text-[11px]">
              Updated {POLICY_META.lastUpdated}
            </span>
          </p>
        </div>

        {/* The document. minHeight:0 is required, not cosmetic: a flex child
            with overflow will not shrink below its content height without it,
            so the card would grow past maxHeight and the footer — with the only
            control on the screen in it — would be pushed off the bottom. */}
        <div className="px-6 sm:px-8 py-5 overflow-y-auto" style={{ flex: '1 1 auto', minHeight: 0 }}>
          <div style={{ display: 'grid', gap: 22 }}>
            <PolicyProse tone="app" />

            {/* Ownership is terms-of-use material rather than privacy material,
                so it is labelled as such instead of being slipped into the
                policy's numbering as though it belonged there. See the note on
                OWNERSHIP_SECTIONS. */}
            <div
              style={{
                borderTop: '1px solid var(--border)',
                paddingTop: 22,
                display: 'grid',
                gap: 24,
              }}
            >
              <div style={{ display: 'grid', gap: 6 }}>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--mint)',
                  }}
                >
                  Terms of use
                </div>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--dim)' }}>
                  Ownership, and what each side is allowed to do with the other's property.
                </p>
              </div>
              <PolicyProse tone="app" sections={OWNERSHIP_SECTIONS} />
            </div>

            {/* Cookies, region-specific rights (California, India), IP
                complaints, and structural boilerplate (survival, assignment,
                definitions). See the note on ADDITIONAL_SECTIONS for why this
                is a third block instead of being folded into the numbering
                above. */}
            <div
              style={{
                borderTop: '1px solid var(--border)',
                paddingTop: 22,
                display: 'grid',
                gap: 24,
              }}
            >
              <div style={{ display: 'grid', gap: 6 }}>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--mint)',
                  }}
                >
                  Additional disclosures
                </div>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--dim)' }}>
                  Cookies, region-specific rights, and a few definitions.
                </p>
              </div>
              <PolicyProse tone="app" sections={ADDITIONAL_SECTIONS} />
            </div>
          </div>
        </div>

        {/* Footer — also outside the scroll area, so the control never has to be
            hunted for at the bottom of a long document. */}
        <div className="px-6 sm:px-8 py-4 border-t border-[var(--border)] bg-[var(--surface2)]">
          <label className="flex items-start gap-3 cursor-pointer select-none mb-3">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--indigo)] cursor-pointer"
            />
            {/* Kept short on instruction — an itemised version naming training,
                accuracy and liability sat here before and read as alarming. */}
            <span className="text-[13px] leading-relaxed text-[var(--text)]">
              I have read and agree to the Privacy Policy and the terms above.
            </span>
          </label>

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <span className="text-[11px] font-mono text-[var(--dim)]">
              Delete a chat, or your account, any time — section 7.
            </span>
            <button
              type="button"
              onClick={accept}
              disabled={!agreed}
              className="bg-[var(--indigo)] hover:bg-[var(--indigo-light)] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-2.5 px-6 rounded-lg transition-colors text-sm uppercase tracking-wider"
            >
              Agree and continue →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
