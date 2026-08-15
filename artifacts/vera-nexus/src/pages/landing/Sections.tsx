/* ---------------------------------------------------------------------------
   Landing sections 4-8: the command centre, the three pillars, how it works,
   the monthly review and the quotes.

   Split out of Landing.tsx purely for file size — the composition order still
   lives there and reads top to bottom.
--------------------------------------------------------------------------- */

import { motion, useInView, useReducedMotion } from 'framer-motion';
import { useRef } from 'react';
import {
  BookMarked,
  CalendarRange,
  Inbox,
  LayoutGrid,
  Layers,
  Map as MapIcon,
  Sparkles,
  Target,
} from 'lucide-react';
import { EASE, Reveal, RevealGroup, RevealItem, Spotlight } from './bits';

/* ============================================================ 4. Command centre */

const RAIL_PRIMARY = [
  { icon: LayoutGrid, label: 'Command Centre', active: true },
  { icon: Target, label: 'Active Goal' },
  { icon: Inbox, label: 'Decision Inbox', count: '3' },
];

const RAIL_CONTINUITY = [
  { icon: MapIcon, label: 'Roadmap', count: '6' },
  { icon: Layers, label: 'Memory', count: '487' },
  { icon: CalendarRange, label: 'Monthly Review' },
  { icon: BookMarked, label: 'Saved Analyses', count: '22' },
];

const INBOX = [
  { title: 'Annual discount — keep, cut or cap it', state: 'Needs you', tone: 'teal' },
  { title: 'Second AE, or a contractor through Q3', state: '3 options ready', tone: 'dim' },
  { title: 'Pause paid search for two weeks', state: 'Waiting on data', tone: 'dim' },
];

const WEEK = [
  { day: 'Mon', marks: ['#2fdcc0'] },
  { day: 'Tue', marks: ['#8b7bff', '#2fdcc0'] },
  { day: 'Wed', marks: ['#e0a340'] },
  { day: 'Thu', marks: ['#2fdcc0', '#2fdcc0'] },
  { day: 'Fri', marks: ['#8b7bff'] },
  { day: 'Sat', marks: [] },
  { day: 'Sun', marks: ['#2fdcc0'] },
];

export function CommandCentreSection() {
  return (
    <section className="lp-section" id="command-centre">
      <div className="lp-container">
        <Reveal>
          <div style={{ maxWidth: 660, marginBottom: 52 }}>
            <div className="lp-eyebrow">Command centre</div>
            <h2 className="lp-h2" style={{ marginTop: 20 }}>
              An operating system for the person running the company.
            </h2>
            <p className="lp-lead" style={{ marginTop: 20 }}>
              One surface holding the goal you're driving, the decisions waiting on you, the plan,
              the memory behind it and the record of what worked. Not a dashboard you check. The
              place the work happens.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.08} y={26} amount={0.12}>
          <div className="lp-os">
            <div className="lp-os-bar">
              <div className="lp-os-lights">
                <span className="lp-os-light" />
                <span className="lp-os-light" />
                <span className="lp-os-light" />
              </div>
              <span className="lp-small" style={{ color: 'var(--lp-text-3)' }}>
                Northwind Labs · Week 31
              </span>
              <div className="lp-os-cmdk">
                Ask or command
                <span className="lp-kbd">⌘K</span>
              </div>
            </div>

            <div className="lp-os-body">
              <aside className="lp-os-rail">
                {RAIL_PRIMARY.map((item) => (
                  <button
                    key={item.label}
                    className="lp-rail-item"
                    data-active={item.active ?? false}
                    type="button"
                  >
                    <item.icon size={14} strokeWidth={1.6} />
                    {item.label}
                    {item.count && <span className="lp-rail-count">{item.count}</span>}
                  </button>
                ))}

                <div className="lp-rail-group">Continuity</div>

                {RAIL_CONTINUITY.map((item) => (
                  <button key={item.label} className="lp-rail-item" type="button">
                    <item.icon size={14} strokeWidth={1.6} />
                    {item.label}
                    {item.count && <span className="lp-rail-count">{item.count}</span>}
                  </button>
                ))}

                <div style={{ marginTop: 'auto', paddingTop: 18 }}>
                  <div className="lp-inset" style={{ padding: '11px 12px' }}>
                    <div className="lp-v-key">Memory since</div>
                    <div className="lp-small" style={{ color: 'var(--lp-text-2)', marginTop: 4 }}>
                      May 2025 · 14 months
                    </div>
                  </div>
                </div>
              </aside>

              <div className="lp-os-canvas">
                {/* Active goal */}
                <Spotlight className="lp-panel">
                  <div className="lp-panel-head">
                    <Target size={13} strokeWidth={1.7} style={{ color: 'var(--lp-teal)' }} />
                    <span className="lp-panel-title">Active goal</span>
                    <span className="lp-panel-meta">12 weeks left</span>
                  </div>
                  <div className="lp-h4" style={{ marginBottom: 14 }}>
                    Reach $40k MRR by September 30
                  </div>
                  <div className="lp-meter">
                    <motion.div
                      className="lp-meter-fill"
                      initial={{ width: 0 }}
                      whileInView={{ width: '62%' }}
                      viewport={{ once: true, amount: 0.6 }}
                      transition={{ duration: 1.4, ease: EASE, delay: 0.25 }}
                    />
                  </div>
                  <div
                    className="lp-v-row"
                    style={{ justifyContent: 'space-between', marginTop: 9 }}
                  >
                    <span className="lp-mono" style={{ color: 'var(--lp-text-2)' }}>
                      $24.8k
                    </span>
                    <span className="lp-mono" style={{ color: 'var(--lp-text-4)' }}>
                      $40k
                    </span>
                  </div>
                  <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
                    <div className="lp-v-row" style={{ gap: 9 }}>
                      <span className="lp-dot" style={{ background: 'var(--lp-teal)' }} />
                      <span className="lp-small" style={{ color: 'var(--lp-text-2)' }}>
                        Mid-market share 58% — target 70%
                      </span>
                    </div>
                    <div className="lp-v-row" style={{ gap: 9 }}>
                      <span className="lp-dot" style={{ background: 'var(--lp-amber)' }} />
                      <span className="lp-small" style={{ color: 'var(--lp-text-2)' }}>
                        Pace implies $36.2k — 1 decision short
                      </span>
                    </div>
                  </div>
                </Spotlight>

                {/* Decision inbox */}
                <Spotlight className="lp-panel">
                  <div className="lp-panel-head">
                    <Inbox size={13} strokeWidth={1.7} style={{ color: 'var(--lp-violet)' }} />
                    <span className="lp-panel-title">Decision inbox</span>
                    <span className="lp-panel-meta">3</span>
                  </div>
                  {INBOX.map((item) => (
                    <div key={item.title} className="lp-inbox-item">
                      <span
                        className="lp-dot"
                        style={{
                          background: item.tone === 'teal' ? 'var(--lp-teal)' : 'var(--lp-text-4)',
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <div className="lp-small" style={{ color: 'var(--lp-text)' }}>
                          {item.title}
                        </div>
                        <div className="lp-v-key" style={{ marginTop: 4 }}>
                          {item.state}
                        </div>
                      </div>
                    </div>
                  ))}
                </Spotlight>

                {/* Week strip */}
                <div className="lp-panel lp-span-2">
                  <div className="lp-panel-head">
                    <CalendarRange size={13} strokeWidth={1.7} style={{ color: 'var(--lp-text-3)' }} />
                    <span className="lp-panel-title">This week</span>
                    <span className="lp-panel-meta">9 events · 2 overnight runs</span>
                  </div>
                  <div className="lp-week">
                    {WEEK.map((day, i) => (
                      <motion.div
                        key={day.day}
                        className="lp-week-day"
                        initial={{ opacity: 0, y: 8 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, amount: 0.5 }}
                        transition={{ duration: 0.7, delay: 0.05 * i, ease: EASE }}
                      >
                        <span className="lp-week-label">{day.day}</span>
                        {day.marks.map((colour, m) => (
                          <span
                            key={m}
                            className="lp-week-mark"
                            style={{ background: colour, opacity: 0.75 }}
                          />
                        ))}
                      </motion.div>
                    ))}
                  </div>
                </div>

                {/* Memory */}
                <Spotlight className="lp-panel">
                  <div className="lp-panel-head">
                    <Layers size={13} strokeWidth={1.7} style={{ color: 'var(--lp-teal)' }} />
                    <span className="lp-panel-title">Memory</span>
                    <span className="lp-panel-meta">487 linked facts</span>
                  </div>
                  <div style={{ display: 'grid', gap: 9 }}>
                    {[
                      'Positioning: seed-stage B2B, not SMB self-serve',
                      'Free tier removed — Jun 14, outcome recorded',
                      'Board asks for CAC payback under 12 months',
                    ].map((line) => (
                      <div key={line} className="lp-v-row" style={{ gap: 9, alignItems: 'start' }}>
                        <span
                          className="lp-node-tick"
                          style={{ background: 'var(--lp-text-4)', marginTop: 6 }}
                        />
                        <span className="lp-small" style={{ color: 'var(--lp-text-2)' }}>
                          {line}
                        </span>
                      </div>
                    ))}
                  </div>
                </Spotlight>

                {/* Monthly review */}
                <Spotlight className="lp-panel">
                  <div className="lp-panel-head">
                    <Sparkles size={13} strokeWidth={1.7} style={{ color: 'var(--lp-violet)' }} />
                    <span className="lp-panel-title">Monthly review</span>
                    <span className="lp-panel-meta">July</span>
                  </div>
                  <div className="lp-small" style={{ color: 'var(--lp-text-2)' }}>
                    Assembling from 22 days of activity — 14 decisions, 6 analyses, 31 learnings.
                  </div>
                  <div className="lp-inset" style={{ marginTop: 13, padding: '12px 13px' }}>
                    <div className="lp-v-key">Shaping up as</div>
                    <div className="lp-h4" style={{ marginTop: 6, fontSize: '.9375rem' }}>
                      The month you stopped buying volume
                    </div>
                  </div>
                </Spotlight>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ================================================================= 5. Why Vera */

function LayersArt() {
  return (
    <svg viewBox="0 0 200 124" fill="none" style={{ width: '100%', height: '100%' }}>
      {[0, 1, 2, 3].map((i) => (
        <g key={i} opacity={1 - i * 0.2}>
          <rect
            x={26 + i * 6}
            y={18 + i * 22}
            width={148 - i * 12}
            height={30}
            rx={7}
            fill="rgba(255,255,255,0.028)"
            stroke={i === 0 ? 'rgba(47,220,192,0.4)' : 'rgba(255,255,255,0.1)'}
          />
          <circle cx={40 + i * 6} cy={33 + i * 22} r={2.5} fill={i === 0 ? '#2fdcc0' : '#4a505e'} />
          <rect
            x={50 + i * 6}
            y={31 + i * 22}
            width={70 - i * 8}
            height={4}
            rx={2}
            fill="rgba(255,255,255,0.14)"
          />
        </g>
      ))}
    </svg>
  );
}

function CausalArt() {
  return (
    <svg viewBox="0 0 200 124" fill="none" style={{ width: '100%', height: '100%' }}>
      {/* Discarded correlations */}
      <path d="M40 96 C 78 78, 100 74, 160 40" stroke="rgba(255,255,255,0.08)" strokeDasharray="3 4" />
      <path d="M40 96 C 96 96, 120 68, 160 62" stroke="rgba(255,255,255,0.08)" strokeDasharray="3 4" />
      {/* The one causal path */}
      <path
        d="M40 96 C 74 96, 84 46, 118 40 S 150 20, 162 18"
        stroke="url(#lp-causal)"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <defs>
        <linearGradient id="lp-causal" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#8b7bff" />
          <stop offset="100%" stopColor="#2fdcc0" />
        </linearGradient>
      </defs>
      <circle cx={40} cy={96} r={4} fill="#8b7bff" />
      <circle cx={118} cy={40} r={3} fill="rgba(255,255,255,0.5)" />
      <circle cx={162} cy={18} r={5} fill="#2fdcc0" />
      <circle cx={162} cy={18} r={11} stroke="rgba(47,220,192,0.3)" />
      <circle cx={160} cy={40} r={2.5} fill="#4a505e" />
      <circle cx={160} cy={62} r={2.5} fill="#4a505e" />
    </svg>
  );
}

function LoopArt() {
  return (
    <svg viewBox="0 0 200 124" fill="none" style={{ width: '100%', height: '100%' }}>
      <ellipse cx={100} cy={62} rx={62} ry={40} stroke="rgba(255,255,255,0.1)" />
      <path
        d="M100 22 A 62 40 0 0 1 162 62"
        stroke="#2fdcc0"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <path
        d="M162 62 A 62 40 0 0 1 100 102"
        stroke="rgba(47,220,192,0.45)"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      {[
        { x: 100, y: 22, r: 4.5, fill: '#2fdcc0' },
        { x: 162, y: 62, r: 3.5, fill: 'rgba(47,220,192,0.7)' },
        { x: 100, y: 102, r: 3.5, fill: '#8b7bff' },
        { x: 38, y: 62, r: 3.5, fill: 'rgba(139,123,255,0.6)' },
      ].map((dot, i) => (
        <circle key={i} cx={dot.x} cy={dot.y} r={dot.r} fill={dot.fill} />
      ))}
      <path d="M44 44 L 38 62 L 50 58" stroke="rgba(139,123,255,0.7)" strokeLinecap="round" />
    </svg>
  );
}

const PILLARS = [
  {
    art: <LayersArt />,
    title: 'Business memory',
    quote: 'Never explain your company twice.',
    body: 'Goals, decisions, analyses, constraints and outcomes are held in one continuous record — and every answer is written against it.',
  },
  {
    art: <CausalArt />,
    title: 'Causal intelligence',
    quote: 'Find causes, not correlations.',
    body: 'Vera separates the thing that moved from the thing that moved with it, then shows you the path it followed to get there.',
  },
  {
    art: <LoopArt />,
    title: 'Decision continuity',
    quote: 'Every decision improves future recommendations.',
    body: 'What you chose, what happened and what it taught you feed forward. The advice you get in month nine is not the advice you got in month one.',
  },
];

export function PillarsSection() {
  return (
    <section className="lp-section" id="why">
      <div className="lp-container">
        <Reveal>
          <div style={{ maxWidth: 620, marginBottom: 52 }}>
            <div className="lp-eyebrow">Why Vera</div>
            <h2 className="lp-h2" style={{ marginTop: 20 }}>
              Three things a chat window structurally cannot do.
            </h2>
          </div>
        </Reveal>

        <RevealGroup className="lp-pillars" stagger={0.1}>
          {PILLARS.map((pillar) => (
            <RevealItem key={pillar.title}>
              <Spotlight className="lp-card lp-pillar" style={{ height: '100%' }}>
                <div className="lp-pillar-art">{pillar.art}</div>
                <div className="lp-eyebrow lp-eyebrow--plain" style={{ color: 'var(--lp-text-3)' }}>
                  {pillar.title}
                </div>
                <div className="lp-h4" style={{ marginTop: 14, fontSize: '1.1875rem' }}>
                  {pillar.quote}
                </div>
                <p className="lp-body" style={{ marginTop: 12, fontSize: '.9063rem' }}>
                  {pillar.body}
                </p>
              </Spotlight>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}

/* ============================================================= 6. How it works */

const STEPS = [
  { n: '01', t: 'Observe', d: 'Your goals, your numbers, the calls you made and what actually happened after.' },
  { n: '02', t: 'Understand', d: 'What the business is trying to do this quarter, and what is standing in the way.' },
  { n: '03', t: 'Model', d: 'How your levers connect to your results — spend to margin, pricing to churn.' },
  { n: '04', t: 'Challenge', d: 'Your assumptions get argued with before you spend money proving them wrong.' },
  { n: '05', t: 'Recommend', d: 'A call to make, with the reasoning, the trade-off and the number it turns on.' },
  { n: '06', t: 'Learn', d: 'The outcome goes back in. Next month starts from here instead of from zero.' },
];

export function HowItWorksSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const reduced = useReducedMotion();

  return (
    <section className="lp-section" id="how">
      <div className="lp-container">
        <Reveal>
          <div style={{ maxWidth: 620, marginBottom: 56 }}>
            <div className="lp-eyebrow">How it works</div>
            <h2 className="lp-h2" style={{ marginTop: 20 }}>
              Six passes, running continuously.
            </h2>
          </div>
        </Reveal>

        <div className="lp-steps" ref={ref}>
          <motion.div
            className="lp-steps-line"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: inView || reduced ? 1 : 0 }}
            transition={{ duration: 1.6, ease: EASE }}
          />
          {STEPS.map((step, i) => (
            <motion.div
              key={step.n}
              className="lp-stepcol"
              initial={{ opacity: 0, y: 14 }}
              animate={inView || reduced ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: 0.12 * i, ease: EASE }}
            >
              <div className="lp-stepcol-n">{step.n}</div>
              <div className="lp-stepcol-node" />
              <div className="lp-h4">{step.t}</div>
              <p className="lp-small" style={{ marginTop: 9, lineHeight: 1.6 }}>
                {step.d}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ======================================================= 7. Monthly founder review */

const REVIEW_CARDS = [
  {
    k: 'Biggest win',
    v: 'Mid-market close rate 19% → 31%',
    n: 'Traced to the June 3 call to lead demos with the causal audit rather than the feature tour.',
  },
  {
    k: 'Biggest risk',
    v: '61% of pipeline from one channel',
    n: 'Concentration has risen three months running. Nothing has been done about it yet.',
  },
  {
    k: 'Most valuable decision',
    v: 'Killing the free tier',
    n: 'Trials fell 22%. Qualified trials rose 40%. CAC payback shortened by five months.',
  },
  {
    k: 'Metric that moved most',
    v: 'CAC payback · 14mo → 9mo',
    n: 'Best month since you started tracking it. Driven by mix, not by spending less.',
  },
  {
    k: 'Focus for next month',
    v: 'A second acquisition channel',
    n: 'Everything else on the roadmap can wait four weeks. This one cannot.',
  },
  // Sixth card exists to close the grid — five leaves a hole in the second row
  // of a three-up layout, which on a card meant to feel shareable reads as a
  // missing tile rather than as whitespace.
  {
    k: 'Asked most often',
    v: 'Why is CAC moving?',
    n: 'Nine times in July. It is now a standing item on the roadmap instead of a question.',
  },
  {
    k: 'The month in one line',
    v: 'You stopped buying volume and started buying intent.',
    n: '14 decisions · 6 analyses · 31 learnings recorded.',
    wide: true,
  },
];

export function ReviewSection() {
  return (
    <section className="lp-section" id="review">
      <div className="lp-container">
        <Reveal>
          <div style={{ maxWidth: 640, marginBottom: 46 }}>
            <div className="lp-eyebrow">Monthly founder review</div>
            <h2 className="lp-h2" style={{ marginTop: 20 }}>
              Your month, written up by something that was there for all of it.
            </h2>
            <p className="lp-lead" style={{ marginTop: 20 }}>
              On the first of every month, Vera assembles a review from your real activity — what
              won, what is quietly getting worse, and the one thing worth your attention next.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.06} y={24} amount={0.15}>
          <div className="lp-wrapped">
            {/* "Northwind Labs" is not a customer and its numbers are not
                results — this is a mockup of the feature, and the same invented
                company that the deleted testimonials were attributed to. The
                section stays, because showing what a product produces is fair;
                the label is what keeps it from reading as a case study. */}
            <div className="lp-wrapped-head">
              <div>
                <div className="lp-v-key" style={{ color: 'var(--lp-teal)' }}>
                  Northwind Labs · sample company
                </div>
                <div className="lp-h3" style={{ marginTop: 10 }}>
                  July review
                </div>
              </div>
              <div className="lp-chip">
                <span className="lp-dot" />
                Example — not a customer's data
              </div>
            </div>

            <RevealGroup className="lp-wrapped-grid" stagger={0.075}>
              {REVIEW_CARDS.map((card) => (
                <RevealItem key={card.k} className={card.wide ? 'lp-rcard-wide' : undefined}>
                  <div className="lp-rcard" style={{ height: '100%', minHeight: card.wide ? 0 : 158 }}>
                    <div className="lp-rcard-k">{card.k}</div>
                    <div className="lp-rcard-v">{card.v}</div>
                    <div className="lp-rcard-n">{card.n}</div>
                  </div>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================== 8. Testimonials — REMOVED */

// There was a TestimonialsSection here: three quotes attributed to "Maya
// Ellison, Founder & CEO, Northwind Labs" and two others, with headshot
// initials, job titles and figures like "a mistake we did not spend $60k
// learning". Every name, company and number was invented. A code comment said
// so and asked whoever shipped the page to swap them for real ones first.
//
// It is deleted rather than commented out or emptied, because the risk was never
// that the layout needed filling. Invented endorsements presented as real
// customers are a deceptive practice in their own right — FTC Act §5 in the US
// and the Consumer Protection Act's unfair-trade-practice provisions in India
// both reach them, and the endorsement rules were tightened specifically to
// cover fabricated reviews. The exposure does not depend on anyone being
// deceived by these particular three.
//
// Vera has no customers to quote yet. The honest version of this section is its
// absence; when there are real, attributed, permissioned quotes, write it again
// from those. Do not restore this one.
