/* ---------------------------------------------------------------------------
   Vera — landing page.

   Section order: hero, the problem, five feature stories, the command centre,
   three pillars, how it works, the monthly review, final CTA. A testimonials
   section used to sit between the review and the CTA; it is gone, and the note
   where it lived in Sections.tsx explains why it is not coming back in that
   form.

   Two decisions worth stating up front:

   1. This page owns its own styling (landing.css) and inherits nothing from
      the app's token/skin system. A visitor who once picked the "vessel" skin
      inside the product should not see a differently-coloured marketing page.

   2. Every looping animation is gated on visibility and every one of them
      collapses to a finished still frame under `prefers-reduced-motion`. The
      page has nine animated figures; without that gating it would have nine
      timers running at all times.
--------------------------------------------------------------------------- */

import { Link } from 'wouter';
import { ArrowRight, Play } from 'lucide-react';
import { MemoryGraph } from './MemoryGraph';
import {
  CausalVisual,
  CompoundVisual,
  OvernightVisual,
  RecallVisual,
  ReviewVisual,
} from './FeatureVisuals';
import {
  CommandCentreSection,
  HowItWorksSection,
  PillarsSection,
  ReviewSection,
} from './Sections';
import { Reveal, SplitText, Spotlight, useScrolledPast, useSequence } from './bits';
import { VeraMark } from '../../components/VeraMark';
import './landing.css';

/* -------------------------------------------------------------------- mark */

// Moved to components/VeraMark so the chat, the sidebar and this page draw
// the same logo from one file — see the note there on why the V won over the
// compass the app used to show.

/* --------------------------------------------------------------------- nav */

const NAV_LINKS = [
  { href: '#why', label: 'Why Vera' },
  { href: '#command-centre', label: 'Command centre' },
  { href: '#how', label: 'How it works' },
  { href: '#review', label: 'Monthly review' },
];

function Nav() {
  const stuck = useScrolledPast(10);

  return (
    <header className="lp-nav" data-stuck={stuck}>
      <div className="lp-container">
        <div className="lp-nav-inner">
          <a className="lp-logo" href="#top">
            <VeraMark />
            Vera
          </a>

          <nav className="lp-nav-links">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link href="/vera" className="lp-btn lp-btn--ghost lp-btn--sm lp-nav-signin">
              Sign in
            </Link>
            <Link href="/enterprise/signup" className="lp-btn lp-btn--primary lp-btn--sm">
              Start Analysis
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------- hero */

function Hero() {
  return (
    <section className="lp-hero" id="top">
      <div className="lp-container">
        <div className="lp-hero-grid">
          <div className="lp-hero-copy">
            <Reveal delay={0.05} y={10}>
              <div className="lp-chip">
                <span className="lp-dot" />
                A founder operating system, not a chat window
              </div>
            </Reveal>

            <h1 className="lp-h1" style={{ marginTop: 26 }}>
              <SplitText text="The cause behind" delay={0.18} />
              <br />
              <SplitText text="every decision." delay={0.34} highlightFrom={0} />
            </h1>

            <Reveal delay={0.62} y={12}>
              <p className="lp-lead" style={{ marginTop: 26, maxWidth: 476 }}>
                Vera remembers your business, learns from every decision, and helps you understand
                what actually drives growth.
              </p>
            </Reveal>

            <Reveal delay={0.72} y={12}>
              <div className="lp-hero-ctas" style={{ marginTop: 34 }}>
                <Link href="/vera" className="lp-btn lp-btn--primary">
                  Start Analysis
                  <ArrowRight size={15} strokeWidth={2} className="lp-btn-arrow" />
                </Link>
                <a href="#command-centre" className="lp-btn lp-btn--ghost">
                  <Play size={13} strokeWidth={2} fill="currentColor" />
                  Watch Demo
                </a>
              </div>
            </Reveal>

            <Reveal delay={0.82} y={10}>
              {/* Second bullet used to read "Your data is never trained on" —
                  false, contradicted section 4 of the policy — then briefly
                  "Delete a chat or your account — it's gone for real", which
                  was true but read as a threat in a hero, not a benefit. Down
                  to one bullet rather than replacing it with a third guess.
                  If a second proof point goes back here, it needs to survive
                  being read cold by a visitor with no context: a security/
                  deletion claim does not, a product benefit does. */}
              <div className="lp-hero-proof" style={{ marginTop: 34 }}>
                <span>
                  <span className="lp-dot" style={{ background: 'var(--lp-teal)' }} />
                  Memory that persists for the life of the company
                </span>
              </div>
            </Reveal>
          </div>

          <Reveal delay={0.3} y={22} amount={0.1}>
            <MemoryGraph />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- problem */

const OLD_WAY = [
  { t: 'Question', s: 'You paste in the context. Again.' },
  { t: 'Answer', s: 'Reasonable. Generic. Unattached to you.' },
  { t: 'Forgotten', s: 'The tab closes. So does the memory.' },
];

const NEW_WAY = [
  { t: 'Question', s: 'Asked against everything Vera already knows.' },
  { t: 'Decision', s: 'Options, trade-offs, and the number it turns on.' },
  { t: 'Outcome', s: 'What actually happened, recorded against the call.' },
  { t: 'Learning', s: 'The rule your business just proved or disproved.' },
  { t: 'Better future advice', s: 'Which is where the next question starts.' },
];

function ProblemSection() {
  const { ref, step } = useSequence(6, 1150);

  return (
    <section className="lp-section">
      <div className="lp-container">
        <Reveal>
          <div style={{ maxWidth: 640, marginBottom: 48 }}>
            <div className="lp-eyebrow">The problem</div>
            <h2 className="lp-h2" style={{ marginTop: 20 }}>
              Advice without memory is just a well-worded guess.
            </h2>
            <p className="lp-lead" style={{ marginTop: 20 }}>
              Every general-purpose assistant meets your company for the first time, every time. The
              cost isn't the typing. It's that nothing you've learned so far is in the room.
            </p>
          </div>
        </Reveal>

        <Reveal y={22} amount={0.2}>
          <div className="lp-compare" ref={ref}>
            {/* Traditional */}
            <div className="lp-card lp-compare-card">
              <div className="lp-compare-head">
                <div>
                  <div className="lp-v-key">Traditional AI</div>
                  <div className="lp-h4" style={{ marginTop: 9 }}>
                    A conversation
                  </div>
                </div>
                <span className="lp-mono" style={{ color: 'var(--lp-text-4)' }}>
                  RETAINED · 0
                </span>
              </div>

              {OLD_WAY.map((item, i) => (
                <div key={item.t}>
                  <div
                    className="lp-step"
                    data-lit={false}
                    data-dead={i === 2 && step >= 2}
                    style={{
                      opacity: step >= i ? (i === 2 && step >= 3 ? 0.32 : 1) : 0.25,
                      transition: 'opacity .7s cubic-bezier(.16,1,.3,1)',
                    }}
                  >
                    <span className="lp-step-i">{i + 1}</span>
                    <span>
                      <span className="lp-step-t">{item.t}</span>
                      <span className="lp-step-sub" style={{ display: 'block' }}>
                        {item.s}
                      </span>
                    </span>
                  </div>
                  {i < OLD_WAY.length - 1 && <div className="lp-connector" data-dashed={i === 1} />}
                </div>
              ))}

              <div className="lp-v-key" style={{ marginTop: 24 }}>
                Every session after this one
              </div>
              <div className="lp-ghosts">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="lp-ghost" style={{ opacity: 0.5 - i * 0.14 }}>
                    <span className="lp-ghost-i" />
                    <span className="lp-ghost-bar" style={{ width: `${58 - i * 13}%` }} />
                  </div>
                ))}
              </div>

              <div
                style={{
                  marginTop: 'auto',
                  paddingTop: 22,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    height: 1,
                    borderTop: '1px dashed rgba(255,255,255,.14)',
                  }}
                />
                <span className="lp-v-key">Each one starts at zero</span>
              </div>
            </div>

            {/* Vera */}
            <div className="lp-card lp-compare-card" data-tone="vera">
              <div className="lp-compare-head">
                <div>
                  <div className="lp-v-key" style={{ color: 'var(--lp-teal)' }}>
                    Vera
                  </div>
                  <div className="lp-h4" style={{ marginTop: 9 }}>
                    A continuous record
                  </div>
                </div>
                <span className="lp-mono" style={{ color: 'var(--lp-teal)' }}>
                  RETAINED · 487
                </span>
              </div>

              {NEW_WAY.map((item, i) => (
                <div key={item.t}>
                  <div
                    className="lp-step"
                    data-lit={step >= i}
                    style={{
                      opacity: step >= i ? 1 : 0.34,
                      transition: 'opacity .7s cubic-bezier(.16,1,.3,1)',
                    }}
                  >
                    <span className="lp-step-i">{i + 1}</span>
                    <span>
                      <span className="lp-step-t">{item.t}</span>
                      <span className="lp-step-sub" style={{ display: 'block' }}>
                        {item.s}
                      </span>
                    </span>
                  </div>
                  {i < NEW_WAY.length - 1 && <div className="lp-connector" />}
                </div>
              ))}

              <div
                className="lp-loopback"
                style={{
                  opacity: step >= 5 ? 1 : 0.3,
                  transition: 'opacity .8s cubic-bezier(.16,1,.3,1)',
                }}
              >
                <span className="lp-loopback-line" />
                Feeds the next question
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- features */

const FEATURES = [
  {
    label: 'Business memory',
    title: 'Never explain your business twice.',
    body: 'Goals, decisions, analyses, constraints and history stay with Vera across weeks and months. Ask a question in July and March is still in the room.',
    outcome: "You stop paying the context tax. Every conversation starts where the last one ended.",
    stage: 'Recall',
    visual: <RecallVisual />,
  },
  {
    label: 'Causal intelligence',
    title: "Find what's actually driving results.",
    body: 'Vera traces the path from an outcome back to its cause — through spend, margin, mix and timing — and shows you what it ruled out on the way there.',
    outcome: 'You spend the next $10k on the thing that moves the number, not the thing that moved alongside it.',
    stage: 'Trace',
    visual: <CausalVisual />,
  },
  {
    label: 'Continuous execution',
    title: 'Wake up to completed work.',
    body: 'Overnight, Vera re-runs the analyses that matter, updates the roadmap, drafts the decisions waiting on you and files what it found.',
    outcome: 'Your morning starts with a call to make, not a backlog to triage.',
    stage: 'Overnight',
    visual: <OvernightVisual />,
  },
  {
    label: 'Decision continuity',
    title: 'Every decision compounds.',
    body: 'Decisions, outcomes and learnings are held as one chain. Recommendations are argued from your history — not from general advice about companies like yours.',
    outcome: 'Month nine is materially sharper than month one. Almost nothing else you use works that way.',
    stage: 'Compound',
    visual: <CompoundVisual />,
  },
  {
    label: 'Founder review',
    title: 'Monthly Founder Review.',
    body: 'On the first of the month, Vera assembles a review out of everything that actually happened — wins, risks, lessons and the one thing worth your attention next.',
    outcome: 'The board update writes itself. You learn something from it before they do.',
    stage: 'Assemble',
    visual: <ReviewVisual />,
  },
];

function FeaturesSection() {
  return (
    <section className="lp-section" style={{ paddingTop: 40 }} id="features">
      <div className="lp-container">
        <Reveal>
          <div style={{ maxWidth: 600, marginBottom: 20 }}>
            <div className="lp-eyebrow">What it does</div>
            <h2 className="lp-h2" style={{ marginTop: 20 }}>
              Five things that only work with memory.
            </h2>
          </div>
        </Reveal>

        {FEATURES.map((feature, i) => (
          <div key={feature.label}>
            <div className="lp-feature" data-flip={i % 2 === 1}>
              <div className="lp-feature-copy">
                <Reveal y={14}>
                  <div className="lp-eyebrow">{feature.label}</div>
                  <h3 className="lp-h3" style={{ marginTop: 18 }}>
                    {feature.title}
                  </h3>
                  <p className="lp-body" style={{ marginTop: 16 }}>
                    {feature.body}
                  </p>
                  <div className="lp-outcome" style={{ marginTop: 26 }}>
                    <ArrowRight
                      size={14}
                      strokeWidth={2}
                      style={{ color: 'var(--lp-teal)', flex: 'none', marginTop: 3 }}
                    />
                    {feature.outcome}
                  </div>
                </Reveal>
              </div>

              <Reveal y={20} delay={0.08} amount={0.2}>
                <Spotlight className="lp-stage">
                  <span className="lp-stage-label">{feature.stage}</span>
                  {feature.visual}
                </Spotlight>
              </Reveal>
            </div>

            {i < FEATURES.length - 1 && <hr className="lp-rule" style={{ opacity: 0.55 }} />}
          </div>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- final CTA */

function FinalCta() {
  return (
    <section className="lp-final">
      <div className="lp-final-glow" />
      <div className="lp-container" style={{ position: 'relative' }}>
        <Reveal>
          <h2
            className="lp-h1"
            style={{ maxWidth: 900, margin: '0 auto', fontSize: 'clamp(2.4rem, 5.2vw, 4.1rem)' }}
          >
            Stop starting from zero
            <br />
            <span className="lp-grad">every time you need advice.</span>
          </h2>
        </Reveal>

        <Reveal delay={0.1}>
          <p className="lp-lead" style={{ maxWidth: 520, margin: '26px auto 0' }}>
            Build a memory layer for your business.
          </p>
        </Reveal>

        <Reveal delay={0.18}>
          <div
            className="lp-hero-ctas"
            style={{ justifyContent: 'center', marginTop: 38 }}
          >
            <Link href="/enterprise/signup" className="lp-btn lp-btn--primary">
              Get Early Access
              <ArrowRight size={15} strokeWidth={2} className="lp-btn-arrow" />
            </Link>
            <a href="#features" className="lp-btn lp-btn--ghost">
              See how it works
            </a>
          </div>
        </Reveal>

        {/* This read "Your data is never used for training". It had to go: the
            privacy policy every account now accepts says in section 4 that we
            DO train on your content. Whichever of the two statements you
            believe, a marketing page promising the opposite of the agreement is
            the worst possible version — it is the misrepresentation, in writing,
            with a signed document contradicting it.

            The replacement links to the policy instead of summarising it, so
            there is one statement of what happens and no second copy to drift. */}
        <Reveal delay={0.26}>
          <p className="lp-small" style={{ marginTop: 26 }}>
            No credit card to start ·{' '}
            <Link href="/privacy" style={{ color: 'var(--lp-teal)' }}>
              How we handle your data
            </Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ footer */

function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-container">
        <div className="lp-footer-inner">
          <div className="lp-logo" style={{ color: 'var(--lp-text-2)' }}>
            <VeraMark size={18} />
            Vera
          </div>
          <div className="lp-footer-links">
            <a href="#why">Why Vera</a>
            <a href="#command-centre">Command centre</a>
            <a href="#how">How it works</a>
            <a href="#review">Monthly review</a>
            {/* Wouter <Link>s, not anchors, because these leave the page — the
                four above are in-page jumps.

                The footer is where a regulator, an app store reviewer or a
                payment processor looks to check that a privacy policy exists at
                all, so it is spelled out twice rather than hidden behind one
                word: the policy itself, and the terms, which live in the same
                document at sections 14-18. Both resolve to /privacy. */}
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/privacy#liability">Terms</Link>
          </div>
          <span className="lp-small">© {new Date().getFullYear()} Vera</span>
        </div>

        {/* Point 10 of the brief, and it belongs on the marketing page rather
            than only in the policy: "The cause behind every decision" is the
            headline at the top of this page, and read literally it is a promise
            that Vera identifies true causes. It cannot guarantee that. Saying so
            here, in the same place the claim is made, is what stops the headline
            from being the misrepresentation — a disclaimer that only exists in a
            document behind a link does not qualify the copy a visitor read.
            Section 16 carries the full version. */}
        <p
          className="lp-small"
          style={{ marginTop: 26, maxWidth: 760, lineHeight: 1.65, color: 'var(--lp-text-3)' }}
        >
          Vera generates analysis with a language model and can be wrong. "The cause behind every
          decision" describes what Vera is built to do, not a guaranteed result — its outputs are
          information for you to weigh, not professional advice, and decisions you take after reading
          them remain yours. Verify anything consequential with a qualified professional. See{' '}
          <Link href="/privacy#no-advice" style={{ color: 'var(--lp-text-2)' }}>
            sections 16 and 17
          </Link>{' '}
          for the full terms.
        </p>
      </div>
    </footer>
  );
}

/* -------------------------------------------------------------------- page */

export function LandingPage() {
  return (
    <div className="lp">
      <div className="lp-grain" />
      <div className="lp-wash" />
      <Nav />
      <main className="lp-main">
        <Hero />
        <ProblemSection />
        <FeaturesSection />
        <CommandCentreSection />
        <PillarsSection />
        <HowItWorksSection />
        <ReviewSection />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

export default LandingPage;
