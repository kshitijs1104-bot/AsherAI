/* ---------------------------------------------------------------------------
   /privacy — the public copy.

   Public and readable without an account, because a policy you can only see
   after signing up is one you cannot read before deciding to sign up. Linked
   from the landing footer.

   Styled with the landing page's own --lp-* tokens rather than the app's, for
   the reason given at the top of landing.css: this is the marketing surface,
   and it must not change colour depending on which skin a visitor happened to
   pick inside the product once.
--------------------------------------------------------------------------- */

import { useEffect } from 'react';
import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { VeraMark } from '../../components/VeraMark';
import { OWNERSHIP_SECTIONS, POLICY_META, PolicyProse } from './privacyPolicy';
import '../landing/landing.css';

export function PrivacyPolicyPage() {
  // The landing footer links to /privacy#no-advice and /privacy#liability so a
  // visitor can go straight to the accuracy and liability terms. Those are
  // client-side navigations: wouter pushes the path and the browser does NOT
  // perform its own hash scroll, because there was never a document load to
  // scroll after. Without this the deep links land at the top of a very long
  // page and the disclaimer they were meant to reach is thousands of pixels
  // away, which makes the footer's promise to show you the terms hollow.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    // Deferred a frame: the sections below have not been laid out at the time
    // this effect first runs, so measuring immediately scrolls to the wrong
    // offset (usually 0).
    const raf = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="lp">
      <div className="lp-grain" />

      <div className="lp-container" style={{ paddingTop: 46, paddingBottom: 96 }}>
        <div style={{ maxWidth: 760 }}>
          <Link
            href="/"
            className="lp-logo"
            style={{ color: 'var(--lp-text-2)', display: 'inline-flex', gap: 8 }}
          >
            <VeraMark size={18} />
            Vera
          </Link>

          <h1 className="lp-h2" style={{ marginTop: 34 }}>
            Privacy Policy
          </h1>
          <p className="lp-small" style={{ marginTop: 12 }}>
            Last updated {POLICY_META.lastUpdated} · Everyone with an account has been shown and has
            agreed to this text.
          </p>

          <div style={{ marginTop: 34, display: 'grid', gap: 30 }}>
            <PolicyProse tone="landing" />

            <div style={{ borderTop: '1px solid var(--lp-line)', paddingTop: 26, display: 'grid', gap: 26 }}>
              <div style={{ display: 'grid', gap: 6 }}>
                <div
                  className="lp-eyebrow"
                  style={{ color: 'var(--lp-teal)' }}
                >
                  Terms of use
                </div>
                <p className="lp-small" style={{ margin: 0 }}>
                  Ownership, and what each side is allowed to do with the other's property.
                </p>
              </div>
              <PolicyProse tone="landing" sections={OWNERSHIP_SECTIONS} />
            </div>
          </div>

          <div style={{ marginTop: 46 }}>
            <Link href="/" className="lp-btn lp-btn--ghost lp-btn--sm">
              <ArrowLeft size={14} strokeWidth={2} />
              Back to Vera
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PrivacyPolicyPage;
