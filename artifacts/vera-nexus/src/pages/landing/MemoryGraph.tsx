/* ---------------------------------------------------------------------------
   The hero visual: a business-memory graph that keeps forming relationships.

   The job of this figure is one sentence — "this thing remembers my business"
   — so every element is a piece of a real founder's context (a goal with a
   number on it, decisions that were logged, risks that are open) rather than
   abstract particles. Nothing here is a chat bubble.

   Construction notes:
   - Nodes are HTML positioned over an SVG edge layer, not SVG text. Real text
     nodes stay crisp, inherit the page's font metrics and cost nothing to
     style; SVG <text> would need manual sizing and would blur under scale.
   - The container is square and the SVG viewBox is 0-100 in both axes, so one
     coordinate system drives both layers: `left: x%` for a chip is the same
     point as `x` for an edge.
   - Only two or three pulses are ever in flight, and the scheduler stops
     entirely when the graph scrolls out of view.
--------------------------------------------------------------------------- */

import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';

type Accent = 'teal' | 'violet' | 'amber';

const ACCENT: Record<Accent, string> = {
  teal: '#2fdcc0',
  violet: '#8b7bff',
  amber: '#e0a340',
};

type Node = {
  id: string;
  label: string;
  value: string;
  x: number;
  y: number;
  accent: Accent;
};

// Six anchors on a loose hexagon. Not a perfect ring — the small
// irregularities are what stop it reading as a logo or a wheel diagram.
const NODES: Node[] = [
  { id: 'goals', label: 'Goals', value: 'Q3 · $40k MRR', x: 50, y: 10, accent: 'teal' },
  { id: 'metrics', label: 'Metrics', value: 'CAC ↓ 18%', x: 84, y: 30, accent: 'teal' },
  { id: 'decisions', label: 'Decisions', value: '14 logged', x: 82, y: 71, accent: 'violet' },
  { id: 'learnings', label: 'Learnings', value: '31 captured', x: 48, y: 90, accent: 'violet' },
  { id: 'risks', label: 'Risks', value: '2 open', x: 17, y: 70, accent: 'amber' },
  { id: 'roadmap', label: 'Roadmap', value: '6 tracks', x: 18, y: 29, accent: 'violet' },
];

const CENTER = { x: 50, y: 50 };

/**
 * Quadratic curve between two anchors, bowed either toward the centre (ring
 * edges, which then sit inside the hexagon and feel like a membrane) or away
 * from it (the three diameters, which would otherwise run straight through
 * the core disc and look like they were drawn on top of it).
 */
function curve(a: Node, b: Node, bow: number, direction: 'in' | 'out') {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  // Pick the perpendicular sign by testing which one moves the control point
  // the way we asked, rather than hand-tuning six signs that would silently
  // become wrong the moment a node is repositioned.
  const plus = Math.hypot(mx + nx * bow - CENTER.x, my + ny * bow - CENTER.y);
  const minus = Math.hypot(mx - nx * bow - CENTER.x, my - ny * bow - CENTER.y);
  const usePlus = direction === 'in' ? plus < minus : plus > minus;
  const sign = usePlus ? 1 : -1;

  return `M ${a.x} ${a.y} Q ${mx + nx * bow * sign} ${my + ny * bow * sign} ${b.x} ${b.y}`;
}

type Edge = { a: number; b: number; d: string };

const EDGES: Edge[] = (() => {
  const ring: Array<[number, number]> = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 0],
  ];
  const across: Array<[number, number]> = [
    [0, 3],
    [1, 4],
    [2, 5],
  ];

  return [
    ...ring.map(([a, b]) => ({ a, b, d: curve(NODES[a]!, NODES[b]!, 7, 'in') })),
    ...across.map(([a, b]) => ({ a, b, d: curve(NODES[a]!, NODES[b]!, 21, 'out') })),
  ];
})();

// The order relationships form in. Fixed rather than random so the sequence
// tells a small story on every loop — a goal reaching a metric, a decision
// reaching a learning — instead of flickering arbitrarily.
const PULSE_ORDER = [0, 6, 2, 8, 4, 1, 7, 3, 5];

type Pulse = { key: number; edge: number };

let pulseKey = 0;

export function MemoryGraph() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.25 });
  const reduced = useReducedMotion();
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const cursor = useRef(0);

  useEffect(() => {
    if (!inView || reduced) return;

    const emit = () => {
      const edge = PULSE_ORDER[cursor.current % PULSE_ORDER.length]!;
      cursor.current += 1;
      // Hard cap. Under a backgrounded tab the interval can bunch up, and
      // without this the graph would come back to life with a dozen pulses
      // firing at once.
      setPulses((prev) => (prev.length >= 3 ? prev : [...prev, { key: pulseKey++, edge }]));
    };

    emit();
    const id = window.setInterval(emit, 1250);
    return () => window.clearInterval(id);
  }, [inView, reduced]);

  const active = new Set<number>();
  for (const pulse of pulses) {
    const edge = EDGES[pulse.edge]!;
    active.add(edge.a);
    active.add(edge.b);
  }

  return (
    <div className="lp-graph" ref={ref} aria-hidden="true">
      <div className="lp-graph-halo" />

      <svg className="lp-graph-edges" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="lp-pulse-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={ACCENT.teal} stopOpacity="0" />
            <stop offset="45%" stopColor={ACCENT.teal} stopOpacity="0.95" />
            <stop offset="100%" stopColor={ACCENT.violet} stopOpacity="0.85" />
          </linearGradient>
        </defs>

        {/* Resting graph. Always drawn, very low contrast: the structure has
            to exist before anything travels along it, otherwise the pulses
            look like they are inventing the connections. */}
        {EDGES.map((edge, i) => (
          <path
            key={`base-${i}`}
            d={edge.d}
            fill="none"
            stroke="rgba(255,255,255,0.085)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {pulses.map((pulse) => (
          <motion.path
            key={pulse.key}
            d={EDGES[pulse.edge]!.d}
            fill="none"
            stroke="url(#lp-pulse-grad)"
            strokeWidth={1.75}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0.17, pathOffset: 0, opacity: 0 }}
            animate={{ pathOffset: 0.83, opacity: [0, 1, 1, 0] }}
            transition={{
              duration: 2.1,
              ease: [0.42, 0, 0.35, 1],
              opacity: { duration: 2.1, times: [0, 0.14, 0.72, 1] },
            }}
            onAnimationComplete={() =>
              setPulses((prev) => prev.filter((p) => p.key !== pulse.key))
            }
          />
        ))}
      </svg>

      <div className="lp-graph-ring" />

      <div className="lp-graph-core">
        <div>
          <div className="lp-core-label">Business memory</div>
          <div className="lp-core-count">487</div>
          <div className="lp-core-label" style={{ letterSpacing: '0.06em' }}>
            linked facts
          </div>
        </div>
      </div>

      {NODES.map((node, i) => (
        <div
          key={node.id}
          className="lp-node"
          data-active={active.has(i)}
          style={{
            left: `${node.x}%`,
            top: `${node.y}%`,
            animationDelay: `${i * 1.6}s`,
          }}
        >
          <div className="lp-node-head">
            <span
              className="lp-node-tick"
              style={{
                background: ACCENT[node.accent],
                boxShadow: active.has(i) ? `0 0 10px ${ACCENT[node.accent]}` : 'none',
              }}
            />
            {node.label}
          </div>
          <div className="lp-node-val">{node.value}</div>
        </div>
      ))}
    </div>
  );
}
