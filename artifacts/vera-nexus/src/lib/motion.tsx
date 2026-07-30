/* ---------------------------------------------------------------------------
   App-surface motion primitives.

   Same approach as the landing page's `pages/landing/bits` — ReactBits-style
   components copied into the repo and owned here rather than pulled in as a
   dependency, all sharing one easing curve so the product moves as a single
   system.

   DELIBERATELY SEPARATE FROM `pages/landing/bits`, which is a near-identical
   set of wrappers. They are not merged because the two surfaces are tuned to
   opposite briefs and merging them would force one to win:

     - The landing page is a marketing page. Its reveals are long (0.85s),
       travel far (18-24px) and are meant to be noticed on first scroll.
     - These are for surfaces a founder opens twenty times a day. A 0.85s
       entrance that replays on every navigation stops reading as polish and
       starts reading as latency, so everything here is faster (0.4-0.5s),
       moves less (6-10px), and never loops.

   Every primitive honours `prefers-reduced-motion` by rendering the settled
   state immediately — motion is never the only thing carrying meaning.
--------------------------------------------------------------------------- */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, useInView, useReducedMotion, type Variants } from 'framer-motion';

/** One curve for every app-side transition. Slow out, no overshoot. */
export const EASE = [0.16, 1, 0.3, 1] as const;

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0 },
};

/**
 * Fades and lifts its children once, when they first scroll into view.
 *
 * `once: true` is not configurable on purpose: a panel that re-animates every
 * time it scrolls back into view is the fastest way to make a working tool
 * feel like a demo.
 */
export function Reveal({
  children,
  delay = 0,
  y = 8,
  className,
  style,
  amount = 0.2,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  style?: CSSProperties;
  amount?: number;
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
      variants={{ hidden: { opacity: 0, y }, shown: { opacity: 1, y: 0 } }}
      transition={{ duration: 0.45, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Staggers its direct `RevealItem` children. */
export function RevealGroup({
  children,
  className,
  style,
  stagger = 0.045,
  delay = 0,
  amount = 0.1,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  stagger?: number;
  delay?: number;
  amount?: number;
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
      variants={{ hidden: {}, shown: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
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
    <motion.div className={className} style={style} variants={itemVariants} transition={{ duration: 0.42, ease: EASE }}>
      {children}
    </motion.div>
  );
}

/**
 * Counts a number up to its value the first time it is seen.
 *
 * Only for counts the founder has no prior expectation of (a monthly total,
 * a streak). Deliberately NOT used for anything they might be reading to
 * compare — a number that is briefly wrong on the way to being right is worse
 * than a number that simply appears.
 */
export function CountUp({ value, durationMs = 750 }: { value: number; durationMs?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!inView || reduced || value === 0) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic — matches the shape of EASE closely enough that a
      // counting number and a moving panel read as the same gesture.
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduced, value, durationMs]);

  return <span ref={ref}>{shown}</span>;
}

/**
 * Pointer-tracked highlight. Writes two custom properties and lets CSS paint
 * the gradient (see `.ve-spot` in index.css), so moving the pointer across a
 * grid of cards re-renders nothing.
 */
export function Spotlight({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      className={`ve-spot ${className}`}
      style={style}
      onPointerMove={(event) => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        el.style.setProperty('--ve-mx', `${event.clientX - rect.left}px`);
        el.style.setProperty('--ve-my', `${event.clientY - rect.top}px`);
      }}
    >
      {children}
    </div>
  );
}
