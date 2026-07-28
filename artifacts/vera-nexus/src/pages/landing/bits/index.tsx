/* ---------------------------------------------------------------------------
   Landing-page motion primitives.

   These are the ReactBits-style pieces the page uses — Reveal, SplitText and
   Spotlight — written in-repo rather than pulled in as a dependency. That is
   how ReactBits is meant to be consumed (you copy the component in and own
   it), and it matters here for three reasons: the page ships no extra bytes
   beyond framer-motion which is already a dependency; every effect can honour
   `prefers-reduced-motion`, which the stock versions do not; and each one can
   be tuned to the same easing curve so the whole page moves as one system
   instead of three libraries' defaults fighting each other.

   Used selectively and nowhere else: hero headline, section reveals, hover.
--------------------------------------------------------------------------- */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { motion, useInView, useReducedMotion, type Variants } from 'framer-motion';

/** One easing curve for the entire page. Slow out, no overshoot, no bounce. */
export const EASE = [0.16, 1, 0.3, 1] as const;

/* ------------------------------------------------------------------ Reveal */

const revealVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  shown: { opacity: 1, y: 0 },
};

/**
 * Fades and lifts its children the first time they scroll into view.
 *
 * `once` is deliberately non-optional in behaviour (always true): re-playing
 * a reveal every time the user scrolls back up is the single most common way
 * a marketing page starts to feel like a demo reel instead of a product.
 */
export function Reveal({
  children,
  delay = 0,
  y = 18,
  className,
  as = 'div',
  amount = 0.35,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: ElementType;
  amount?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount });
  const reduced = useReducedMotion();
  const MotionTag = motion[as as 'div'] ?? motion.div;

  return (
    <MotionTag
      ref={ref}
      className={className}
      initial={reduced ? 'shown' : 'hidden'}
      animate={inView || reduced ? 'shown' : 'hidden'}
      variants={{ hidden: { opacity: 0, y }, shown: { opacity: 1, y: 0 } }}
      transition={{ duration: 0.85, delay, ease: EASE }}
    >
      {children}
    </MotionTag>
  );
}

/**
 * Same reveal, but staggers its direct children. Children must be `RevealItem`
 * (or any motion element using the `revealVariants` names above).
 */
export function RevealGroup({
  children,
  className,
  stagger = 0.07,
  delay = 0,
  amount = 0.25,
  style,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
  amount?: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount });
  const reduced = useReducedMotion();

  return (
    <motion.div
      ref={ref}
      className={className}
      style={style}
      initial={reduced ? 'shown' : 'hidden'}
      animate={inView || reduced ? 'shown' : 'hidden'}
      variants={{
        hidden: {},
        shown: { transition: { staggerChildren: stagger, delayChildren: delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <motion.div
      className={className}
      style={style}
      variants={revealVariants}
      transition={{ duration: 0.8, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/* --------------------------------------------------------------- SplitText */

/**
 * Word-by-word headline reveal.
 *
 * Splits on words rather than characters on purpose. Per-character staggering
 * on a 40px headline reads as a typewriter gimmick and, more practically,
 * breaks text selection and screen-reader output. Words keep the line legible
 * the whole way through and the headline still assembles.
 *
 * The visible spans are aria-hidden and the full string is exposed once via a
 * visually-hidden node, so assistive tech reads one sentence, not eight words.
 */
export function SplitText({
  text,
  className,
  delay = 0,
  stagger = 0.055,
  highlightFrom,
}: {
  text: string;
  className?: string;
  delay?: number;
  stagger?: number;
  /** Word index from which the gradient treatment starts. */
  highlightFrom?: number;
}) {
  const reduced = useReducedMotion();
  const words = text.split(' ');

  if (reduced) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      <span
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}
      >
        {text}
      </span>
      <span aria-hidden="true">
        {words.map((word, i) => (
          <span
            key={`${word}-${i}`}
            style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom' }}
          >
            <motion.span
              style={{ display: 'inline-block', willChange: 'transform' }}
              className={highlightFrom !== undefined && i >= highlightFrom ? 'lp-grad' : undefined}
              initial={{ y: '108%' }}
              animate={{ y: 0 }}
              transition={{ duration: 1.05, delay: delay + i * stagger, ease: EASE }}
            >
              {word}
              {i < words.length - 1 ? ' ' : ''}
            </motion.span>
          </span>
        ))}
      </span>
    </span>
  );
}

/* --------------------------------------------------------------- Spotlight */

/**
 * Pointer-tracked highlight for a card.
 *
 * Writes two custom properties on pointermove and lets CSS paint the gradient
 * (see `.lp-spotlight::after`). No React state, so moving the mouse across a
 * grid of cards does not re-render anything — which is the whole reason this
 * is affordable on a page with ~20 hoverable surfaces.
 */
export function Spotlight({
  children,
  className = '',
  as: Tag = 'div',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null);

  const onMove = (event: ReactPointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--lp-mx', `${event.clientX - rect.left}px`);
    el.style.setProperty('--lp-my', `${event.clientY - rect.top}px`);
  };

  return (
    <Tag ref={ref} className={`lp-spotlight ${className}`} onPointerMove={onMove} {...rest}>
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------- hooks */

/**
 * Advances a step counter on an interval, but only while the element is on
 * screen. Every looping visual on this page runs through here, which is what
 * keeps a page with nine animated figures from pinning a CPU core: at any
 * moment only the one or two visuals actually in the viewport are ticking.
 *
 * Returns the current step and the ref to attach.
 */
export function useSequence(steps: number, intervalMs = 1400) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!inView || reduced) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % steps), intervalMs);
    return () => window.clearInterval(id);
  }, [inView, reduced, steps, intervalMs]);

  // With motion reduced, show the finished state rather than a frozen first
  // frame — the still image should be the one that carries the meaning.
  return { ref, step: reduced ? steps - 1 : step, inView };
}

/** True once the window has scrolled past `threshold` px. Used by the nav. */
export function useScrolledPast(threshold = 12) {
  const [past, setPast] = useState(false);

  useEffect(() => {
    const onScroll = () => setPast(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return past;
}
