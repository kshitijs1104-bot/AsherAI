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

   WHAT THIS DELIBERATELY DOES NOT DO IS GATE THE BUTTON ON SCROLLING TO THE
   END. That was the first version, and measuring it killed it: the policy is
   ~5,800px of text in a ~430px window, so the requirement amounted to fourteen
   screenfuls or — what everyone would actually do — one drag of the scrollbar
   to the bottom. It would have produced no more reading than this does and a
   worse first impression, and "the user dragged a scrollbar" is not a stronger
   consent record than "the user ticked an unticked box".

   What is load-bearing instead:

     - The plain-terms summary is ABOVE the fold at every window height that
       matters. The six lines that would surprise someone are read by default,
       not by diligence.
     - Two jump links put the two clauses people would object to — training, and
       possible sale — one click away rather than fourteen scrolls away.
     - The checkbox starts unticked and names both of those things in its own
       label, so agreeing is affirmative and specific rather than a byproduct of
       wanting to get to the app.
--------------------------------------------------------------------------- */

import { useRef, useState } from 'react';
import { acceptPrivacy } from '../../lib/privacyConsent';
import {
  OWNERSHIP_SECTIONS,
  POLICY_META,
  PolicyProse,
  PolicySummary,
} from './privacyPolicy';

// Takes no props and returns nothing: acceptPrivacy() writes the record and
// notifies the store behind usePrivacyAccepted, so whoever is gating on that —
// RequireConsent, and the SkinPicker beside it — re-renders on its own. An
// onAccept callback would be a second, redundant path to the same state change,
// and the two could disagree.
export function PrivacyGate() {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [agreed, setAgreed] = useState(false);

  // Scrolls the named section to the top of the reading pane. scrollIntoView is
  // avoided on purpose: the pane is a nested scroll container inside a
  // fixed-height card, and scrollIntoView on a descendant will also scroll the
  // page behind it, which shifts the whole dialog on short windows.
  //
  // Measured from rects plus the pane's current scrollTop rather than from
  // offsetTop. The first version subtracted pane.offsetTop from
  // target.offsetTop, which is only meaningful when both are measured against
  // the same offsetParent — they are not, because the pane is not a positioned
  // element, so each resolved against a different ancestor and the difference
  // came out at roughly zero. Both jump links silently did nothing.
  // Instant, via scrollTop, rather than scrollTo({behavior:'smooth'}). Smooth
  // scrolling is an animation, so it needs frames: in a background tab, or any
  // context where the page is not compositing, the call is accepted and does
  // nothing at all — which is how the earlier offsetTop bug stayed invisible
  // for as long as it did. A jump straight to the clause is also the better
  // reading of what the link promises.
  const jumpTo = (id: string) => {
    const pane = scroller.current;
    const target = pane?.querySelector<HTMLElement>(`#${id}`);
    if (!pane || !target) return;
    const delta = target.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    pane.scrollTop = pane.scrollTop + delta - 8;
  };

  const accept = () => {
    if (!agreed) return;
    acceptPrivacy();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-gate-title"
      className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-3 sm:p-6"
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
            className="text-xl sm:text-2xl font-syne font-extrabold text-white mb-1.5"
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
        <div
          ref={scroller}
          className="px-6 sm:px-8 py-3 overflow-y-auto"
          style={{ flex: '1 1 auto', minHeight: 0 }}
        >
          {/* gap 16 and py-3, not the 24 and py-5 this started at. Measured at a
              1280x720 window — the smallest laptop worth designing for — the
              jump row plus the summary came to 15px more than the pane, so the
              sixth summary line ("what you write is yours, Vera is ours") sat
              just under the fold. It is the line most worth having above it. */}
          <div style={{ display: 'grid', gap: 16 }}>
            {/* The clauses someone might actually refuse, reachable without a
                scroll — and ABOVE the summary rather than below it, because
                below it they landed a few pixels under the fold at a 720px
                window, which is the one place they needed to be visible.
                Training because it is compulsory; liability because it is where
                the risk of acting on an output is allocated. If either loses you
                a signup, that is the system working: better here than in a
                complaint later. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--dim)]">
                Read first
              </span>
              <button
                type="button"
                onClick={() => jumpTo('training')}
                className="text-[var(--mint)] underline underline-offset-2 hover:opacity-80"
              >
                4. Storing and training on your data
              </button>
              <button
                type="button"
                onClick={() => jumpTo('no-advice')}
                className="text-[var(--mint)] underline underline-offset-2 hover:opacity-80"
              >
                16. No guarantee of accuracy
              </button>
              <button
                type="button"
                onClick={() => jumpTo('liability')}
                className="text-[var(--mint)] underline underline-offset-2 hover:opacity-80"
              >
                17. Limits on our liability
              </button>
            </div>

            <PolicySummary tone="app" />
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
            {/* Names the three things a person is most likely to say they were
                never told: that training is compulsory, that outputs are not
                guaranteed, and that liability is capped. A checkbox whose label
                says only "I agree to the terms" is the one a court is most
                willing to read narrowly. */}
            <span className="text-[13px] leading-relaxed text-[var(--text)]">
              I have read and agree to the Privacy Policy and the terms above — including that Vera
              stores and trains on my content and that this is not optional (section 4), that its
              recommendations are not guaranteed to be accurate and acting on them is my own risk
              (section 16), and the limits on liability in section 17.
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
