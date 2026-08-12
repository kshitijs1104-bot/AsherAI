import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Braces, Copy, Pin, ArrowRight, Paperclip } from 'lucide-react';
import { Gauge, Inline, Label, MONO, StatusPill } from '../ui';
import { TURNS, type Turn, type VeraCard } from '../data';

/* ---------------------------------------------------------------------------
 * Causal Trace — the conversation surface.
 *
 * Card structure, density and information hierarchy are carried over
 * unchanged; only the skin reads from the palette engine. The JSON view under
 * each card renders the exact payload shape pages/Venus.tsx consumes.
 * ------------------------------------------------------------------------ */

const SIGILS: Record<VeraCard['type'], ReactElement> = {
  analysis: (
    <>
      <circle cx="6" cy="17.5" r="3" fill="currentColor" />
      <circle cx="18" cy="6.5" r="3" fill="none" stroke="currentColor" strokeWidth="2.1" />
      <path d="M8.4 15.1 15.6 8.9" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </>
  ),
  risk: (
    <>
      <path d="M12 3.5 22 20.5H2L12 3.5Z" stroke="currentColor" strokeWidth="2.1" fill="none" strokeLinejoin="round" />
      <path d="M12 10.5v3.4" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
    </>
  ),
  decision: (
    <path
      d="M12 21.5v-8.8M12 12.7 4.8 4.5M12 12.7l7.2-8.2"
      stroke="currentColor"
      strokeWidth="2.2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  roadmap: (
    <>
      <path d="M2.5 12h19" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M7 7.5v9M17 7.5v9" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </>
  ),
};

function Sparkline() {
  return (
    <svg
      width="96"
      height="24"
      viewBox="0 0 96 24"
      className="shrink-0"
      role="img"
      aria-label="Blended CAC across six weeks, rising from $412 to $551"
    >
      <defs>
        <linearGradient id="vp-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--p-crit)" stopOpacity=".26" />
          <stop offset="100%" stopColor="var(--p-crit)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0,22 L19.2,21.1 L38.4,15.8 L57.6,9.6 L76.8,5.5 L96,2 L96,24 L0,24 Z"
        fill="url(#vp-spark)"
      />
      <path
        d="M0,22 L19.2,21.1 L38.4,15.8 L57.6,9.6 L76.8,5.5 L96,2"
        fill="none"
        stroke="var(--p-crit)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="96" cy="2" r="2.3" fill="var(--p-crit)" />
    </svg>
  );
}

function jsonHighlight(value: unknown): string {
  const raw = JSON.stringify(value, null, 2)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return raw.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
    (match, str: string | undefined, colon: string | undefined, bool: string | undefined, num: string | undefined) => {
      if (str) {
        return colon
          ? `<span style="color:var(--p-sx-key);font-weight:700">${str}</span><span style="color:var(--p-sx-punct)">${colon}</span>`
          : `<span style="color:var(--p-sx-str)">${str}</span>`;
      }
      if (bool) return `<span style="color:var(--p-sx-bool);font-weight:700">${bool}</span>`;
      if (num) return `<span style="color:var(--p-sx-num);font-weight:700">${num}</span>`;
      return match;
    },
  );
}

function CardBody({ card }: { card: VeraCard }) {
  const c = card.content;

  if (card.type === 'analysis') {
    return (
      <div className="flex flex-col">
        {(c.points ?? []).map((p, i, arr) => (
          <div
            key={p.label}
            className="grid gap-x-5 gap-y-1 items-start py-[11px] sm:grid-cols-[152px_1fr] grid-cols-1"
            style={{ borderBottom: i === arr.length - 1 ? 'none' : '1px solid var(--p-line)', paddingTop: i === 0 ? 0 : undefined, paddingBottom: i === arr.length - 1 ? 0 : undefined }}
          >
            <div className="pt-[3px]">
              <Label>{p.label}</Label>
            </div>
            <div className="flex items-center gap-3.5 flex-wrap text-[13.5px] font-medium leading-[1.62]" style={{ color: 'var(--p-text-2)' }}>
              <span>
                <Inline text={p.value} />
              </span>
              {p.spark ? <Sparkline /> : null}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (card.type === 'risk') {
    return (
      <div className="flex flex-col gap-3">
        {(c.risks ?? []).map((r, i) => {
          const level = /high|critical|severe/i.test(r.impact) ? 'high' : /med/i.test(r.impact) ? 'med' : 'low';
          return (
            <div
              key={r.name}
              className="flex flex-col gap-1.5"
              style={i === 0 ? undefined : { borderTop: '1px solid var(--p-line)', paddingTop: 12 }}
            >
              <div className="flex items-center gap-3">
                <span className="flex-1 min-w-0 text-[13.5px] font-bold leading-[1.4]" style={{ color: 'var(--p-text)' }}>
                  {r.name}
                </span>
                <Gauge level={level} />
                <span
                  className="w-[54px] text-right text-[9.5px] font-bold uppercase shrink-0"
                  style={{
                    fontFamily: MONO,
                    letterSpacing: '.13em',
                    color: level === 'high' ? 'var(--p-crit)' : level === 'med' ? 'var(--p-warn)' : 'var(--p-text-2)',
                  }}
                >
                  {r.impact}
                </span>
              </div>
              <div className="text-[13px] font-medium leading-[1.6]" style={{ color: 'var(--p-text-2)' }}>
                <Inline text={r.mitigation} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (card.type === 'decision') {
    return (
      <div>
        <div
          className="rounded-xl px-3.5 py-3 mb-3"
          style={{ background: 'var(--p-accent-tint)', border: '1px solid var(--p-accent-edge)' }}
        >
          <div className="mb-1.5">
            <Label style={{ color: 'var(--p-accent-2)' }}>Recommendation</Label>
          </div>
          <p className="m-0 text-[13.5px] font-medium leading-[1.6]" style={{ color: 'var(--p-text)' }}>
            <Inline text={c.recommendation ?? ''} />
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {(c.options ?? []).map((o) => (
            <div
              key={o.name}
              className="rounded-xl px-3.5 py-3"
              style={{
                background: o.chosen ? 'var(--p-accent-tint)' : 'var(--p-card-2)',
                border: `1px solid ${o.chosen ? 'var(--p-accent-edge)' : 'var(--p-line)'}`,
              }}
            >
              <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                <span className="text-[13.5px] font-bold" style={{ color: 'var(--p-text)' }}>
                  {o.name}
                </span>
                {o.chosen ? <StatusPill tone="accent">Recommended</StatusPill> : null}
              </div>
              <p className="m-0 text-[13px] font-medium leading-[1.6]" style={{ color: 'var(--p-text-2)' }}>
                <Inline text={o.reasoning} />
              </p>
              <div
                className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2.5 pt-2.5"
                style={{ borderTop: '1px solid var(--p-line)' }}
              >
                {Object.entries(o.scores).map(([k, v]) => (
                  <span key={k} className="flex items-baseline gap-2">
                    <Label>{k.replace(/_/g, ' ')}</Label>
                    <b
                      className="text-[12px] font-bold"
                      style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: 'var(--p-text)' }}
                    >
                      {v}
                    </b>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {(c.phases ?? []).map((p, i, arr) => (
        <div
          key={p.period}
          className="relative grid gap-4 sm:grid-cols-[88px_1fr] grid-cols-1"
          style={{ paddingBottom: i === arr.length - 1 ? 0 : 18 }}
        >
          {i === arr.length - 1 ? null : (
            <span
              className="absolute hidden sm:block"
              style={{ left: 92, top: 16, bottom: -2, width: 1, background: 'var(--p-line)' }}
              aria-hidden="true"
            />
          )}
          <div className="sm:text-right pt-[3px]">
            <Label>{p.period}</Label>
          </div>
          <div className="relative sm:pl-[18px]">
            <span
              className="absolute hidden sm:block rounded-full"
              style={{
                left: -4.5,
                top: 6,
                width: 8,
                height: 8,
                background: 'var(--p-bg)',
                border: '2px solid var(--p-accent)',
              }}
              aria-hidden="true"
            />
            <h4 className="m-0 mb-1 text-[13.5px] font-bold" style={{ color: 'var(--p-text)' }}>
              {p.title}
            </h4>
            <p className="m-0 text-[13px] font-medium leading-[1.6]" style={{ color: 'var(--p-text-2)' }}>
              <Inline text={p.goal} />
            </p>
            <ul className="mt-2 mb-0 pl-4 flex flex-col gap-1.5 list-disc" style={{ color: 'var(--p-text-2)' }}>
              {p.actions.map((a) => (
                <li key={a} className="text-[12.5px] font-medium leading-[1.55]" style={{ color: 'var(--p-text-2)' }}>
                  {a}
                </li>
              ))}
            </ul>
            <div className="mt-2.5 flex items-baseline gap-2 flex-wrap">
              <Label>Metric</Label>
              <span
                className="text-[11.5px] font-bold"
                style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: 'var(--p-text)' }}
              >
                {p.metric}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function previewLine(card: VeraCard): string {
  const c = card.content;
  if (card.type === 'analysis') return c.points?.[0]?.label ?? '';
  if (card.type === 'risk') return c.risks?.[0]?.name ?? '';
  if (card.type === 'decision') return 'Cut the variant to 10% today';
  return c.phases?.[0]?.title ?? '';
}

function Card({ card, index }: { card: VeraCard; index: number }) {
  const [open, setOpen] = useState(!card.collapsed);
  const [raw, setRaw] = useState(false);
  const [hover, setHover] = useState(false);

  const payload = {
    type: card.type,
    role: index === 0 ? 'primary' : 'supporting',
    title: card.title,
    content: card.content,
  };

  return (
    <article
      className="vp-rise rounded-2xl overflow-hidden"
      style={{
        background: 'var(--p-card)',
        border: `1px solid ${hover ? 'var(--p-line-2)' : 'var(--p-line)'}`,
        boxShadow: hover ? 'var(--p-elev-2)' : 'var(--p-elev)',
        animationDelay: `${index * 110}ms`,
        transition: 'border-color .2s, box-shadow .2s',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-center gap-2.5 px-4 pt-3.5">
        <svg viewBox="0 0 24 24" className="w-[15px] h-[15px] shrink-0" style={{ color: 'var(--p-accent-2)' }} aria-hidden="true">
          {SIGILS[card.type]}
        </svg>
        <span
          className="text-[9.5px] font-bold uppercase shrink-0"
          style={{ fontFamily: MONO, letterSpacing: '.16em', color: 'var(--p-text-2)' }}
        >
          {card.kind}
        </span>
        <span className="flex-1 min-w-0 text-[14px] font-bold" style={{ color: 'var(--p-text)', letterSpacing: '-.016em' }}>
          {card.title}
        </span>
        <span className="flex items-center gap-0.5 shrink-0" style={{ opacity: hover ? 1 : 0, transition: 'opacity .2s' }}>
          <button
            type="button"
            title={raw ? 'Show rendered card' : 'View JSON payload'}
            aria-label={raw ? 'Show rendered card' : 'View JSON payload'}
            aria-pressed={raw}
            onClick={() => setRaw((v) => !v)}
            className="w-7 h-7 grid place-items-center rounded-md"
            style={{
              color: raw ? 'var(--p-accent-2)' : 'var(--p-text-2)',
              background: raw ? 'var(--p-accent-tint)' : 'transparent',
            }}
          >
            <Braces className="w-[15px] h-[15px]" strokeWidth={2} />
          </button>
          <button type="button" title="Pin to Command Centre" aria-label="Pin to Command Centre" className="vp-hover w-7 h-7 grid place-items-center rounded-md" style={{ color: 'var(--p-text-2)' }}>
            <Pin className="w-[15px] h-[15px]" strokeWidth={2} />
          </button>
          <button type="button" title="Copy card" aria-label="Copy card" className="vp-hover w-7 h-7 grid place-items-center rounded-md" style={{ color: 'var(--p-text-2)' }}>
            <Copy className="w-[15px] h-[15px]" strokeWidth={2} />
          </button>
        </span>
      </div>

      <div className="h-px mx-4 mt-3" style={{ background: 'var(--p-line)' }} />

      {!open ? (
        <div className="flex items-baseline gap-3 px-4 py-3.5">
          <span className="flex-1 min-w-0 truncate text-[13px] font-semibold" style={{ color: 'var(--p-text-2)' }}>
            {previewLine(card)}
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[10px] font-bold uppercase shrink-0"
            style={{ fontFamily: MONO, letterSpacing: '.13em', color: 'var(--p-accent-2)' }}
          >
            Open
          </button>
        </div>
      ) : raw ? (
        <div className="px-4 pb-4 pt-3.5">
          <pre
            className="m-0 rounded-xl px-3.5 py-3 overflow-x-auto text-[12px] leading-[1.65]"
            style={{
              background: 'var(--p-sx-bg)',
              border: '1px solid var(--p-line)',
              fontFamily: MONO,
              color: 'var(--p-text-2)',
            }}
            dangerouslySetInnerHTML={{ __html: jsonHighlight(payload) }}
          />
        </div>
      ) : (
        <div className="px-4 pb-4 pt-3.5">
          <CardBody card={card} />
        </div>
      )}
    </article>
  );
}

/* BlurText — the AI response only. blur(4px) resolving over 200ms per word. */
function BlurText({ text, step = 30 }: { text: string; step?: number }) {
  const words = text.split(/(\s+)/).filter(Boolean);
  let wordIndex = 0;
  return (
    <>
      {words.map((token, i) => {
        if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
        const delay = wordIndex * step;
        wordIndex += 1;
        return (
          <span key={i} className="vp-blur inline-block" style={{ animationDelay: `${delay}ms` }}>
            <Inline text={token} />
          </span>
        );
      })}
    </>
  );
}

function Tracing({ steps, done }: { steps: string[]; done: number }) {
  return (
    <div className="flex flex-col gap-2">
      {steps.slice(0, done + 1).map((s, i) => {
        const complete = i < done;
        return (
          <div
            key={s}
            className="vp-rise flex items-center gap-2.5 text-[12.5px] font-semibold"
            style={{ fontFamily: MONO, color: complete ? 'var(--p-text-2)' : 'var(--p-text)' }}
          >
            <span className="relative w-3.5 h-3.5 shrink-0">
              {complete ? (
                <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" aria-hidden="true">
                  <path d="M3 7.5 6 10.5 11.5 4" fill="none" stroke="var(--p-ok)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span
                  className="vp-spin absolute inset-0 rounded-full"
                  style={{ border: '1.6px solid var(--p-line-2)', borderTopColor: 'var(--p-accent-2)' }}
                />
              )}
            </span>
            <span>{s}</span>
          </div>
        );
      })}
    </div>
  );
}

function VeraTurn({ turn }: { turn: Turn }) {
  const [phase, setPhase] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setPhase(turn.steps.length + 1);
      return;
    }
    const total = turn.steps.length + 1;
    for (let i = 1; i <= total; i += 1) {
      timers.current.push(window.setTimeout(() => setPhase(i), i * 460));
    }
    const ids = timers.current;
    return () => {
      ids.forEach(window.clearTimeout);
      timers.current = [];
    };
  }, [turn.steps.length]);

  const answering = phase > turn.steps.length;

  return (
    <div className="flex gap-3.5">
      <div
        className="shrink-0 w-7 h-7 rounded-[10px] grid place-items-center mt-0.5"
        style={{ background: 'var(--p-card)', border: '1px solid var(--p-line)', boxShadow: 'var(--p-elev)' }}
      >
        <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" aria-hidden="true">
          <path d="M5 6.5 12 18l7-11.5" stroke="var(--p-accent-2)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-[18px]">
        {!answering ? (
          <Tracing steps={turn.steps} done={Math.min(phase, turn.steps.length)} />
        ) : (
          <>
            <p
              className="m-0 text-[15.5px] font-medium leading-[1.68] max-w-[68ch]"
              style={{ color: 'var(--p-text-2)' }}
            >
              <BlurText text={turn.answer} />
            </p>

            <div className="flex flex-col gap-3">
              {turn.cards.map((card, i) => (
                <Card key={card.title} card={card} index={i} />
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap text-[11px] font-bold" style={{ fontFamily: MONO, color: 'var(--p-text-2)' }}>
              <span style={{ color: 'var(--p-text-2)' }}>TRACED FROM</span>
              {turn.sources.map((s, i) => (
                <span key={s} className="flex items-center gap-2">
                  {i > 0 ? <span style={{ color: 'var(--p-text-3)' }}>·</span> : null}
                  <span style={{ color: 'var(--p-text)' }}>{s}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function CausalTrace() {
  const [turns, setTurns] = useState<Turn[]>([TURNS['cac']!]);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length]);

  const ask = (turn: Turn, typed?: string) => {
    setTurns((prev) => (prev.some((t) => t.id === turn.id && !typed) ? prev : [...prev, typed ? { ...turn, question: typed } : turn]));
  };

  return (
    <div className="relative h-full flex flex-col">
      <div className="flex-1 overflow-y-auto vp-scroll">
        <div className="max-w-[840px] mx-auto px-6 pt-8 pb-[210px] flex flex-col gap-9">
          {turns.map((turn) => (
            <div key={`${turn.id}-${turn.question}`} className="flex flex-col gap-9">
              <div className="flex justify-end">
                <div
                  className="max-w-[74%] px-4 py-3 text-[15px] font-medium leading-[1.55]"
                  style={{
                    background: 'var(--p-card)',
                    border: '1px solid var(--p-line)',
                    boxShadow: 'var(--p-elev)',
                    borderRadius: '16px 16px 5px 16px',
                    color: 'var(--p-text)',
                  }}
                >
                  {turn.question}
                </div>
              </div>
              <VeraTurn turn={turn} />
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="absolute left-0 right-0 bottom-0 z-20 pointer-events-none px-6 pt-9 pb-5">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            maskImage: 'linear-gradient(180deg, transparent, #000 32%)',
            WebkitMaskImage: 'linear-gradient(180deg, transparent, #000 32%)',
            background: 'linear-gradient(180deg, transparent, var(--p-bg) 48%)',
          }}
        />
        <div className="relative max-w-[840px] mx-auto flex flex-col gap-2.5 pointer-events-auto">
          <div className="flex gap-2 flex-wrap">
            {[
              { label: 'So what do I actually do this week?', turn: TURNS['act']! },
              { label: 'Show the causal trace again', turn: TURNS['cac']! },
            ].map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => ask(s.turn)}
                className="vp-hover rounded-xl px-3.5 py-2.5 text-[12.5px] font-semibold text-left"
                style={{
                  background: 'var(--p-card)',
                  border: '1px solid var(--p-line)',
                  boxShadow: 'var(--p-elev)',
                  color: 'var(--p-text-2)',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = draft.trim();
              if (!value) return;
              setDraft('');
              ask(TURNS['act']!, value);
            }}
            className="vp-composer flex items-end gap-2 rounded-2xl pl-2 pr-1.5 py-1.5"
            style={{
              background: 'var(--p-bg-2)',
              border: '1px solid var(--p-line)',
              boxShadow: 'var(--p-elev)',
            }}
          >
            <button type="button" aria-label="Attach a file" title="Attach a file" className="vp-hover w-9 h-9 grid place-items-center rounded-lg shrink-0" style={{ color: 'var(--p-text-2)' }}>
              <Paperclip className="w-4 h-4" strokeWidth={2} />
            </button>
            <textarea
              value={draft}
              rows={1}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Tell Vera what's really going on…"
              className="flex-1 min-w-0 resize-none bg-transparent outline-none text-[15px] font-medium py-2.5 max-h-32"
              style={{ color: 'var(--p-text)', letterSpacing: '-.021em' }}
            />
            <button
              type="submit"
              className="shrink-0 inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13.5px] font-bold"
              style={{ background: 'var(--p-accent)', color: 'var(--p-on-accent)', boxShadow: 'var(--p-elev)' }}
            >
              Trace
              <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.6} />
            </button>
          </form>

          <div className="flex items-center gap-2.5 px-1 text-[10.5px] font-bold" style={{ fontFamily: MONO, letterSpacing: '.06em', color: 'var(--p-text-2)' }}>
            <span>DEMO SURFACE · SCRIPTED RESPONSES</span>
            <span className="rounded px-1.5 py-[3px]" style={{ border: '1px solid var(--p-line)', background: 'var(--p-card-2)', color: 'var(--p-text)' }}>
              ⏎ SEND
            </span>
            <span className="rounded px-1.5 py-[3px]" style={{ border: '1px solid var(--p-line)', background: 'var(--p-card-2)', color: 'var(--p-text)' }}>
              ⇧⏎ NEWLINE
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
