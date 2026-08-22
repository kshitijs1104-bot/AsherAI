/* ---------------------------------------------------------------------------
   The five feature figures.

   Each one is a small loop that only runs while it is on screen (see
   `useSequence`), and each one animates the specific claim its copy makes —
   retrieval, causal tracing, overnight work, compounding, assembly. They are
   deliberately built from the same parts as the product surface (rows, labels,
   meters, timestamps) so the page never shows a shape the software does not
   have.
--------------------------------------------------------------------------- */

import { motion } from 'framer-motion';
import { ArrowDown, ArrowUpRight, Check, CornerDownRight, Moon, Sunrise, X } from 'lucide-react';
import { EASE, useSequence } from './bits';

const fade = (on: boolean, y = 8) => ({
  opacity: on ? 1 : 0,
  transform: `translateY(${on ? 0 : y}px)`,
  transition: `opacity .7s ${'cubic-bezier(.16,1,.3,1)'}, transform .7s cubic-bezier(.16,1,.3,1)`,
});

/* ------------------------------------------- 1. Never explain your business twice */

const MEMORIES = [
  { when: 'Mar 04', what: 'Positioning locked: seed-stage B2B, not SMB self-serve', tag: 'Decision' },
  { when: 'Apr 22', what: 'SMB trials converted at 4% — parked the segment', tag: 'Analysis' },
  { when: 'Jun 11', what: 'Goal: $40k MRR by Sept, 70% from mid-market', tag: 'Goal' },
];

// Each of these sequences runs several steps past its last visible change.
// Those trailing steps are a deliberate hold: the resolved frame — the answer,
// the root cause, the morning brief — is the one carrying the argument, and at
// the original step counts it was on screen for barely a second before the
// loop wiped it. Holding it for four or five seconds is the difference between
// a figure that reads as a product and one that reads as a slideshow.
export function RecallVisual() {
  const { ref, step } = useSequence(9, 1150);

  return (
    <div ref={ref} className="lp-v-col" style={{ gap: 14, flex: 1 }}>
      <div className="lp-v-item" style={{ ...fade(step >= 0), borderColor: 'rgba(255,255,255,.1)' }}>
        <div className="lp-v-key">You, today</div>
        <div className="lp-v-strong" style={{ marginTop: 5 }}>
          Should we go back after the SMB segment?
        </div>
      </div>

      <div className="lp-v-key" style={{ ...fade(step >= 1), display: 'flex', alignItems: 'center', gap: 7 }}>
        <CornerDownRight size={12} strokeWidth={1.75} />
        Recalling 3 of 487 linked facts
      </div>

      <div className="lp-v-col" style={{ gap: 7 }}>
        {MEMORIES.map((memory, i) => (
          <div
            key={memory.when}
            className="lp-v-item"
            data-on={step >= i + 1}
            style={{
              ...fade(step >= i + 1, 10),
              borderColor: step >= i + 1 ? 'rgba(47,220,192,.26)' : 'rgba(255,255,255,.055)',
              background: step >= i + 1 ? 'rgba(47,220,192,.045)' : undefined,
            }}
          >
            <div className="lp-v-row" style={{ gap: 9 }}>
              <span className="lp-v-key" style={{ minWidth: 44 }}>
                {memory.when}
              </span>
              <span className="lp-v-txt" style={{ flex: 1 }}>
                {memory.what}
              </span>
              <span className="lp-v-key" style={{ color: 'var(--lp-teal)' }}>
                {memory.tag}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div
        className="lp-v-item"
        style={{
          ...fade(step >= 5, 12),
          marginTop: 'auto',
          borderColor: 'rgba(255,255,255,.12)',
          background: 'linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.015))',
        }}
      >
        <div className="lp-v-key" style={{ color: 'var(--lp-teal)' }}>Asher</div>
        <div className="lp-v-txt" style={{ marginTop: 6, color: 'var(--lp-text)' }}>
          Not yet — you parked SMB in April at 4% trial conversion, and your Sept goal needs 70% of
          revenue from mid-market. Re-entering now competes with that.
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------- 2. What is actually driving results */

const CHAIN = [
  { label: 'Revenue', value: '−12% MoM', tone: 'bad' },
  { label: 'Gross margin', value: '−6.4 pts', tone: 'bad' },
  { label: 'Marketing spend', value: '+38%', tone: 'warn' },
];

export function CausalVisual() {
  const { ref, step } = useSequence(7, 1250);

  return (
    <div ref={ref} className="lp-v-col" style={{ gap: 10, flex: 1 }}>
      {CHAIN.map((link, i) => (
        <div key={link.label} style={fade(step >= i)}>
          <div className="lp-v-item lp-v-row" style={{ gap: 10 }}>
            <span className="lp-v-strong" style={{ flex: 1 }}>{link.label}</span>
            <span
              className="lp-mono"
              style={{ color: link.tone === 'bad' ? '#ef6b6b' : 'var(--lp-amber)' }}
            >
              {link.value}
            </span>
          </div>
          <div
            className="lp-v-arrow"
            style={{
              opacity: step >= i + 1 ? 1 : 0,
              transition: 'opacity .6s ease',
            }}
          >
            <ArrowDown size={13} strokeWidth={1.5} />
            <span className="lp-v-key">explains</span>
          </div>
        </div>
      ))}

      <div
        className="lp-v-item"
        style={{
          ...fade(step >= 3, 12),
          borderColor: 'rgba(47,220,192,.4)',
          background: 'linear-gradient(90deg, rgba(47,220,192,.1), rgba(47,220,192,.02))',
        }}
      >
        <div className="lp-v-key" style={{ color: 'var(--lp-teal)' }}>Root cause</div>
        <div className="lp-v-strong" style={{ marginTop: 5 }}>
          Annual-plan discounting, introduced Feb 9
        </div>
        <div className="lp-v-txt" style={{ marginTop: 4, fontSize: '.78rem' }}>
          Volume held. Realised price per seat did not.
        </div>
      </div>

      <div
        className="lp-v-row"
        style={{
          ...fade(step >= 4),
          gap: 8,
          marginTop: 'auto',
          paddingTop: 12,
          borderTop: '1px solid rgba(255,255,255,.06)',
        }}
      >
        <X size={12} strokeWidth={2} style={{ color: 'var(--lp-text-4)' }} />
        <span className="lp-v-key">Ruled out — site traffic +9%, correlated, no causal path</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------ 3. Wake up to completed work */

const NIGHT_WORK = [
  { at: '23:41', what: 'Re-ran retention by acquisition cohort' },
  { at: '01:07', what: 'Updated Q3 roadmap — 2 tracks slipped' },
  { at: '03:22', what: 'Drafted 3 options for the pricing decision' },
  { at: '05:14', what: 'Flagged CAC drift on paid search' },
];

export function OvernightVisual() {
  const { ref, step } = useSequence(9, 1050);

  return (
    <div ref={ref} className="lp-v-col" style={{ gap: 14, flex: 1 }}>
      <div className="lp-v-row" style={{ gap: 10 }}>
        <Moon size={13} strokeWidth={1.5} style={{ color: 'var(--lp-violet)' }} />
        <div
          style={{
            flex: 1,
            height: 3,
            borderRadius: 999,
            background:
              'linear-gradient(90deg, rgba(139,123,255,.5), rgba(139,123,255,.2) 40%, rgba(224,163,64,.45))',
          }}
        />
        <Sunrise size={13} strokeWidth={1.5} style={{ color: 'var(--lp-amber)' }} />
      </div>

      <div className="lp-v-col" style={{ gap: 7 }}>
        {NIGHT_WORK.map((task, i) => {
          const done = step >= i + 1;
          return (
            <div key={task.at} className="lp-v-item lp-v-row" style={{ ...fade(step >= i, 6), gap: 10 }}>
              <span
                style={{
                  width: 15,
                  height: 15,
                  borderRadius: 5,
                  display: 'grid',
                  placeItems: 'center',
                  flex: 'none',
                  border: `1px solid ${done ? 'rgba(47,220,192,.5)' : 'rgba(255,255,255,.14)'}`,
                  background: done ? 'rgba(47,220,192,.16)' : 'transparent',
                  transition: 'all .5s cubic-bezier(.16,1,.3,1)',
                }}
              >
                {done && <Check size={9} strokeWidth={3} style={{ color: 'var(--lp-teal)' }} />}
              </span>
              <span className="lp-v-key" style={{ minWidth: 34 }}>{task.at}</span>
              <span className="lp-v-txt" style={{ flex: 1, opacity: done ? 1 : 0.55 }}>
                {task.what}
              </span>
            </div>
          );
        })}
      </div>

      <motion.div
        className="lp-v-item"
        animate={{
          opacity: step >= 5 ? 1 : 0,
          y: step >= 5 ? 0 : 22,
        }}
        transition={{ duration: 0.9, ease: EASE }}
        style={{
          marginTop: 'auto',
          borderColor: 'rgba(255,255,255,.13)',
          background: 'linear-gradient(180deg, rgba(224,163,64,.06), rgba(255,255,255,.014))',
        }}
      >
        <div className="lp-v-row" style={{ gap: 8 }}>
          <span className="lp-v-strong">Morning brief</span>
          <span className="lp-v-key" style={{ marginLeft: 'auto' }}>06:10 · 4 items</span>
        </div>
        <div className="lp-v-txt" style={{ marginTop: 7, fontSize: '.78rem' }}>
          One decision needs you. Two roadmap dates moved. CAC is the number to watch this week.
        </div>
      </motion.div>
    </div>
  );
}

/* --------------------------------------------------------- 4. Every decision compounds */

const LEDGER = [
  {
    when: 'Mar',
    decision: 'Raised SMB price 12%',
    outcome: 'Churn flat, MRR +9%',
    learning: 'Price elasticity is low under 50 seats',
  },
  {
    when: 'May',
    decision: 'Added annual discount',
    outcome: 'Margin −6.4 pts',
    learning: 'Discounting buys volume you already had',
  },
  {
    when: 'Jun',
    decision: 'Killed the free tier',
    outcome: 'Trials −22%, quality ↑',
    learning: 'Intent beats top-of-funnel volume here',
  },
];

const CONFIDENCE = [38, 57, 74, 86];

export function CompoundVisual() {
  const { ref, step: rawStep } = useSequence(6, 1500);
  // Steps 4 and 5 are the hold; everything below reads the clamped value so
  // the ledger and the meter stay at their resolved state through them.
  const step = Math.min(rawStep, 3);

  return (
    <div ref={ref} className="lp-v-col" style={{ gap: 14, flex: 1 }}>
      <div className="lp-v-item" style={{ borderColor: 'rgba(255,255,255,.11)' }}>
        <div className="lp-v-row" style={{ gap: 8 }}>
          <span className="lp-v-key" style={{ color: 'var(--lp-teal)' }}>Today's recommendation</span>
          <span className="lp-mono" style={{ marginLeft: 'auto', color: 'var(--lp-text-2)' }}>
            {CONFIDENCE[step]}% confidence
          </span>
        </div>
        <div className="lp-meter" style={{ marginTop: 9 }}>
          <motion.div
            className="lp-meter-fill"
            animate={{ width: `${CONFIDENCE[step]}%` }}
            transition={{ duration: 1.1, ease: EASE }}
          />
        </div>
        <div className="lp-v-txt" style={{ marginTop: 11, color: 'var(--lp-text)' }}>
          {step >= 3
            ? 'Raise mid-market list price 10%. Hold SMB. Do not reintroduce an annual discount.'
            : step >= 1
              ? 'Consider a price change — evidence is still thin on which segment.'
              : 'Consider a price change.'}
        </div>
      </div>

      <div className="lp-v-key">Built from what already happened</div>

      {/* Rows are always present and dim, never absent. Hiding them until
          their step meant the first 1.5s of every loop showed an almost empty
          panel — the figure looked broken for a quarter of its cycle. Dimmed
          rows also read better: the history exists, it is being folded in. */}
      <div className="lp-v-col" style={{ gap: 7 }}>
        {LEDGER.map((row, i) => {
          const folded = step >= i + 1;
          return (
          <div
            key={row.when}
            className="lp-v-item"
            style={{
              opacity: folded ? 1 : 0.34,
              transition: 'opacity .8s cubic-bezier(.16,1,.3,1)',
              borderColor: folded ? 'rgba(139,123,255,.24)' : 'rgba(255,255,255,.055)',
            }}
          >
            <div className="lp-v-row" style={{ gap: 9 }}>
              <span className="lp-v-key" style={{ minWidth: 26 }}>{row.when}</span>
              <span className="lp-v-txt" style={{ color: 'var(--lp-text)' }}>{row.decision}</span>
              <span className="lp-v-key" style={{ marginLeft: 'auto' }}>{row.outcome}</span>
            </div>
            <div className="lp-v-row" style={{ gap: 7, marginTop: 6, paddingLeft: 35 }}>
              <ArrowUpRight size={11} strokeWidth={1.75} style={{ color: 'var(--lp-violet)' }} />
              <span className="lp-v-txt" style={{ fontSize: '.78rem' }}>{row.learning}</span>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- 5. Monthly Founder Review */

const TILES = [
  { k: 'Biggest win', v: 'Mid-market close rate 19% → 31%', from: { x: -34, y: -26 } },
  { k: 'Biggest risk', v: 'One channel is 61% of pipeline', from: { x: 30, y: -34 } },
  { k: 'Best decision', v: 'Killing the free tier', from: { x: -28, y: 30 } },
  { k: 'Moved most', v: 'CAC payback 14mo → 9mo', from: { x: 36, y: 22 } },
  { k: 'Lesson', v: 'Discounts bought volume you had', from: { x: -18, y: 38 } },
  { k: 'Next month', v: 'Second acquisition channel', from: { x: 26, y: -18 } },
];

export function ReviewVisual() {
  const { ref, step } = useSequence(12, 700);

  return (
    <div ref={ref} className="lp-v-col" style={{ gap: 14, flex: 1 }}>
      <div className="lp-v-row" style={{ gap: 10 }}>
        <span className="lp-v-strong">July · Founder Review</span>
        <span className="lp-v-key" style={{ marginLeft: 'auto' }}>
          {Math.min(step, 6)}/6 assembled
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          flex: 1,
          alignContent: 'start',
        }}
      >
        {TILES.map((tile, i) => {
          const landed = step >= i + 1;
          return (
            <motion.div
              key={tile.k}
              className="lp-v-item"
              animate={{
                opacity: landed ? 1 : 0,
                x: landed ? 0 : tile.from.x,
                y: landed ? 0 : tile.from.y,
                scale: landed ? 1 : 0.94,
              }}
              transition={{ duration: 1, ease: EASE }}
              style={{ minHeight: 74 }}
            >
              <div className="lp-v-key">{tile.k}</div>
              <div className="lp-v-txt" style={{ marginTop: 6, color: 'var(--lp-text)' }}>
                {tile.v}
              </div>
            </motion.div>
          );
        })}
      </div>

      <div
        className="lp-v-row"
        style={{ ...fade(step >= 7), gap: 8, justifyContent: 'center', paddingTop: 2 }}
      >
        <span className="lp-chip" style={{ height: 27 }}>
          <span className="lp-dot" />
          Ready to share with your board
        </span>
      </div>
    </div>
  );
}
