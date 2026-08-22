import type { ReactNode } from 'react';
import {
  ChevronLeft, GitBranch, LayoutGrid, Workflow, Fingerprint, Plug, Plus, Settings,
} from 'lucide-react';
import { MONO } from './ui';
import { HISTORY } from './data';

export type ViewId = 'trace' | 'workflows' | 'dossier' | 'connections';

export const NAV: { id: ViewId; label: string; icon: typeof GitBranch }[] = [
  { id: 'trace', label: 'Causal Trace', icon: GitBranch },
  { id: 'workflows', label: 'Workflow Hub', icon: Workflow },
  { id: 'dossier', label: 'Dossier Storage', icon: Fingerprint },
  { id: 'connections', label: 'Data Connections', icon: Plug },
];

export const RAIL_CLOSED = 64;
export const RAIL_OPEN = 256;

function Tip({ children, show }: { children: ReactNode; show: boolean }) {
  if (!show) return null;
  return (
    <span
      className="vp-tip absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 z-20 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] font-semibold pointer-events-none opacity-0"
      style={{
        color: 'var(--p-text)',
        background: 'var(--p-bg-2)',
        border: '1px solid var(--p-line)',
        boxShadow: 'var(--p-elev-2)',
      }}
    >
      {children}
    </span>
  );
}

export function Sidebar({
  open,
  view,
  onView,
  onToggle,
}: {
  open: boolean;
  view: ViewId;
  onView: (id: ViewId) => void;
  onToggle: () => void;
}) {
  return (
    <aside
      className="relative z-30 shrink-0 h-full flex flex-col"
      style={{
        width: open ? RAIL_OPEN : RAIL_CLOSED,
        background: 'var(--p-glass)',
        backdropFilter: 'blur(24px) saturate(160%)',
        WebkitBackdropFilter: 'blur(24px) saturate(160%)',
        borderRight: '1px solid var(--p-line)',
        transition: 'width .42s cubic-bezier(.32,.72,0,1)',
        /* No overflow:hidden on the aside itself — that is what used to clip
           the re-open control out of existence. Only the scrolling history
           list clips, and it clips itself. */
      }}
    >
      {/* Head */}
      <div className="flex items-center gap-2.5 h-[60px] px-3 shrink-0 overflow-hidden">
        <div className="w-10 h-10 grid place-items-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
            <path
              d="M5 6.5 12 18l7-11.5"
              stroke="var(--p-accent-2)"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span
          className="flex-1 min-w-0 text-[15px] font-bold whitespace-nowrap"
          style={{
            color: 'var(--p-text)',
            letterSpacing: '-.02em',
            opacity: open ? 1 : 0,
            transition: 'opacity .2s ease .1s',
          }}
        >
          Asher
        </span>
      </div>

      {/* New analysis */}
      <div className="px-3 pb-1.5 shrink-0">
        <button
          type="button"
          className="vp-hover group relative flex items-center w-full h-10 rounded-xl overflow-visible"
          style={{
            background: 'var(--p-card)',
            border: '1px solid var(--p-line)',
            boxShadow: 'var(--p-elev)',
            color: 'var(--p-text)',
          }}
        >
          <span className="w-[38px] shrink-0 grid place-items-center" style={{ color: 'var(--p-accent-2)' }}>
            <Plus className="w-[17px] h-[17px]" strokeWidth={2.2} />
          </span>
          <span
            className="flex-1 text-left text-[13.5px] font-bold whitespace-nowrap pr-3"
            style={{ letterSpacing: '-.014em', opacity: open ? 1 : 0, transition: 'opacity .2s ease .1s' }}
          >
            New analysis
          </span>
          <Tip show={!open}>New analysis</Tip>
        </button>
      </div>

      {/* Primary nav */}
      <nav className="px-3 pt-1 pb-2 flex flex-col gap-[3px] shrink-0" aria-label="Views">
        {NAV.map((item) => {
          const on = item.id === view;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onView(item.id)}
              aria-current={on ? 'page' : undefined}
              className="vp-hover group relative flex items-center w-full h-10 rounded-xl overflow-visible"
              style={{
                background: on ? 'var(--p-accent-tint)' : 'transparent',
                border: `1px solid ${on ? 'var(--p-accent-edge)' : 'transparent'}`,
                color: on ? 'var(--p-text)' : 'var(--p-text-2)',
              }}
            >
              <span
                className="w-[38px] shrink-0 grid place-items-center"
                style={{ color: on ? 'var(--p-accent-2)' : 'inherit' }}
              >
                <Icon className="w-[18px] h-[18px]" strokeWidth={on ? 2.2 : 1.9} />
              </span>
              <span
                className="flex-1 text-left text-[13.5px] font-bold whitespace-nowrap pr-3"
                style={{ letterSpacing: '-.014em', opacity: open ? 1 : 0, transition: 'opacity .2s ease .1s' }}
              >
                {item.label}
              </span>
              <Tip show={!open}>{item.label}</Tip>
            </button>
          );
        })}
      </nav>

      {/* Conversation groups — only reachable in the open state */}
      <div
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 pb-3 vp-scroll"
        style={{
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: open ? 'opacity .22s ease .12s' : 'opacity .16s ease',
        }}
        aria-hidden={!open}
      >
        {HISTORY.map((group) => (
          <div key={group.when}>
            <div
              className="px-2 pt-4 pb-2 text-[10px] font-bold uppercase whitespace-nowrap"
              style={{ fontFamily: MONO, letterSpacing: '.14em', color: 'var(--p-text-2)' }}
            >
              {group.when}
            </div>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onView('trace')}
                className="vp-hover w-full text-left rounded-lg px-2.5 py-2 flex items-baseline gap-2"
                style={{
                  background: item.active ? 'var(--p-accent-tint)' : 'transparent',
                  color: item.active ? 'var(--p-text)' : 'var(--p-text-2)',
                }}
              >
                <span
                  className="flex-1 min-w-0 truncate text-[12.5px]"
                  style={{ fontWeight: item.active ? 700 : 600, letterSpacing: '-.012em' }}
                >
                  {item.title}
                </span>
                <span
                  className="shrink-0 text-[10px] font-bold"
                  style={{ fontFamily: MONO, color: 'var(--p-text-2)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {item.time}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        className="shrink-0 flex items-center gap-2.5 px-3 py-3 overflow-hidden"
        style={{ borderTop: '1px solid var(--p-line)' }}
      >
        <div className="w-10 shrink-0 grid place-items-center">
          <span
            className="w-7 h-7 rounded-lg grid place-items-center text-[11px] font-bold"
            style={{ background: 'var(--p-accent)', color: 'var(--p-on-accent)' }}
          >
            KS
          </span>
        </div>
        <div
          className="flex-1 min-w-0 whitespace-nowrap"
          style={{ opacity: open ? 1 : 0, transition: 'opacity .2s ease .1s' }}
        >
          <div className="text-[13px] font-bold truncate" style={{ color: 'var(--p-text)' }}>
            Kshitij
          </div>
          <div className="text-[10.5px] font-bold" style={{ fontFamily: MONO, letterSpacing: '.1em', color: 'var(--p-text-2)' }}>
            ENTERPRISE
          </div>
        </div>
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          className="vp-hover w-8 h-8 grid place-items-center rounded-lg shrink-0"
          style={{ color: 'var(--p-text-2)', opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity .2s ease .1s' }}
        >
          <Settings className="w-4 h-4" strokeWidth={1.9} />
        </button>
      </div>

      {/* The persistent re-open control.
          Anchored to the rail's own right edge and rendered OUTSIDE any
          clipping context, so it is equally visible and clickable in both
          states — this is the fix for the panel locking itself away when
          closed. It stays mounted; only the chevron's direction changes. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? 'Collapse navigation panel' : 'Expand navigation panel'}
        title={open ? 'Collapse panel' : 'Expand panel'}
        className="vp-edge absolute top-1/2 -right-[13px] z-40 w-[26px] h-[52px] grid place-items-center rounded-full"
        style={{
          transform: 'translateY(-50%)',
          background: 'var(--p-bg-2)',
          border: '1px solid var(--p-line-2)',
          boxShadow: 'var(--p-elev-2)',
          color: 'var(--p-text)',
        }}
      >
        <ChevronLeft
          className="w-[15px] h-[15px]"
          strokeWidth={2.4}
          style={{ transform: open ? 'none' : 'rotate(180deg)', transition: 'transform .42s cubic-bezier(.32,.72,0,1)' }}
        />
      </button>
    </aside>
  );
}

export { LayoutGrid };
