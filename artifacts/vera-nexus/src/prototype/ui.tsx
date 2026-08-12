import type { CSSProperties, ReactNode } from 'react';

/* ---------------------------------------------------------------------------
 * Shared primitives and the typographic scale.
 *
 * The contrast rule for this prototype, applied everywhere below:
 *   - Every label, value, timestamp, status and piece of micro-copy reads
 *     --p-text or --p-text-2, never --p-text-3.
 *   - Descriptor text (labels, properties, statuses) is font-bold or
 *     font-semibold, never font-normal, so hierarchy survives at a glance
 *     and at low vision.
 *   - --p-text-3 is reserved for decorative rules, disabled controls and
 *     placeholder glyphs.
 * ------------------------------------------------------------------------ */

export const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace';

/** Uppercase data-property label. Bold on purpose — these are scanned, not read. */
export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      className="text-[10.5px] font-bold uppercase leading-[1.5]"
      style={{ fontFamily: MONO, letterSpacing: '.12em', color: 'var(--p-text-2)', ...style }}
    >
      {children}
    </span>
  );
}

/** Section eyebrow above a group of panels. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div
      className="text-[10.5px] font-bold uppercase"
      style={{ fontFamily: MONO, letterSpacing: '.16em', color: 'var(--p-text-2)' }}
    >
      {children}
    </div>
  );
}

export function Panel({
  children,
  className = '',
  style,
  inset,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  inset?: boolean;
}) {
  return (
    <div
      className={`rounded-xl ${className}`}
      style={{
        background: inset ? 'var(--p-card-2)' : 'var(--p-card)',
        border: '1px solid var(--p-line)',
        boxShadow: inset ? 'none' : 'var(--p-elev)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function PageHead({
  eyebrow,
  title,
  blurb,
  actions,
}: {
  eyebrow: string;
  title: string;
  blurb: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 mb-7">
      <div className="min-w-0">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1
          className="text-[26px] font-semibold leading-[1.15] mt-2"
          style={{ color: 'var(--p-text)', letterSpacing: '-.028em', textWrap: 'balance' }}
        >
          {title}
        </h1>
        <p
          className="text-[14px] font-medium leading-[1.6] mt-2 max-w-[62ch]"
          style={{ color: 'var(--p-text-2)' }}
        >
          {blurb}
        </p>
      </div>
      {actions ? <div className="flex items-center gap-2 shrink-0 pt-1">{actions}</div> : null}
    </div>
  );
}

export type Tone = 'ok' | 'warn' | 'crit' | 'accent' | 'idle';

const TONE_COLOR: Record<Tone, string> = {
  ok: 'var(--p-ok)',
  warn: 'var(--p-warn)',
  crit: 'var(--p-crit)',
  accent: 'var(--p-accent-2)',
  idle: 'var(--p-text-2)',
};

/** Status pill. Bold uppercase, and the dot repeats the state in shape+colour. */
export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const color = TONE_COLOR[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 shrink-0 rounded-md px-2 py-[3px] text-[9.5px] font-bold uppercase leading-[1.6]"
      style={{
        fontFamily: MONO,
        letterSpacing: '.13em',
        color,
        background: tone === 'idle' ? 'var(--p-card-2)' : 'color-mix(in srgb, currentColor 13%, transparent)',
        border: `1px solid ${tone === 'idle' ? 'var(--p-line)' : 'color-mix(in srgb, currentColor 42%, transparent)'}`,
      }}
    >
      <span className="w-[5px] h-[5px] rounded-full shrink-0" style={{ background: color }} />
      {children}
    </span>
  );
}

/** Three-segment severity gauge — severity encoded in form, not only colour. */
export function Gauge({ level }: { level: 'high' | 'med' | 'low' }) {
  const filled = level === 'high' ? 3 : level === 'med' ? 2 : 1;
  const color = level === 'high' ? 'var(--p-crit)' : level === 'med' ? 'var(--p-warn)' : 'var(--p-text-2)';
  return (
    <span className="flex items-center gap-[3px] shrink-0" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="block w-3 h-[3px] rounded-sm"
          style={{ background: i < filled ? color : 'var(--p-line-2)' }}
        />
      ))}
    </span>
  );
}

export function Meter({ pct, tone = 'accent' }: { pct: number; tone?: Tone }) {
  return (
    <div className="h-[6px] rounded-full overflow-hidden" style={{ background: 'var(--p-line)' }}>
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          background: TONE_COLOR[tone],
          transition: 'width .7s cubic-bezier(.32,.72,0,1)',
        }}
      />
    </div>
  );
}

export function IconButton({
  label,
  onClick,
  active,
  children,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="w-8 h-8 grid place-items-center rounded-lg shrink-0 disabled:opacity-45"
      style={{
        color: active ? 'var(--p-accent-2)' : 'var(--p-text-2)',
        background: active ? 'var(--p-accent-tint)' : 'transparent',
        border: '1px solid transparent',
        transition: 'color .18s, background .18s, border-color .18s',
      }}
      onMouseEnter={(e) => {
        if (disabled || active) return;
        e.currentTarget.style.background = 'var(--p-hover)';
        e.currentTarget.style.color = 'var(--p-text)';
      }}
      onMouseLeave={(e) => {
        if (disabled || active) return;
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--p-text-2)';
      }}
    >
      {children}
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  full,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'quiet';
  disabled?: boolean;
  full?: boolean;
}) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-[7px] text-[12.5px] font-semibold disabled:opacity-45 shrink-0';
  const style: CSSProperties =
    variant === 'primary'
      ? { background: 'var(--p-accent)', color: 'var(--p-on-accent)', border: '1px solid var(--p-accent)', boxShadow: 'var(--p-elev)' }
      : variant === 'quiet'
        ? { background: 'transparent', color: 'var(--p-text-2)', border: '1px solid transparent' }
        : { background: 'var(--p-card)', color: 'var(--p-text)', border: '1px solid var(--p-line)' };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${full ? 'w-full' : ''}`}
      style={{ ...style, letterSpacing: '-.012em', transition: 'background .18s, border-color .18s, color .18s' }}
    >
      {children}
    </button>
  );
}

/** Segmented control used for the Dossier tabs and the wrap period picker. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-xl p-1 shrink-0"
      style={{ background: 'var(--p-card-2)', border: '1px solid var(--p-line)' }}
      role="tablist"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className="rounded-lg px-3 py-[6px] text-[12px] font-bold"
            style={{
              letterSpacing: '-.01em',
              color: on ? 'var(--p-on-accent)' : 'var(--p-text-2)',
              background: on ? 'var(--p-accent)' : 'transparent',
              boxShadow: on ? 'var(--p-elev)' : 'none',
              transition: 'background .2s, color .2s',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Inline markdown: **bold** and `mono`. Same two marks the live renderer handles. */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} className="font-bold" style={{ color: 'var(--p-text)' }}>
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <span
              key={i}
              className="text-[.93em] font-semibold"
              style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: 'var(--p-text)' }}
            >
              {part.slice(1, -1)}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** Entrance used on view switch — short, damped, and off under reduced motion. */
export function Rise({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <div className="vp-rise" style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}
