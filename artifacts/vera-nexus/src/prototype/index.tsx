import { useEffect, useRef, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { Sidebar, NAV, type ViewId } from './Sidebar';
import { MONO, StatusPill } from './ui';
import { PRESETS, readSidebarOpen, usePreset, writeSidebarOpen, type Preset } from './theme';
import { CausalTrace } from './views/CausalTrace';
import { WorkflowHub } from './views/WorkflowHub';
import { DossierStorage } from './views/DossierStorage';
import { DataConnections } from './views/DataConnections';

/* ---------------------------------------------------------------------------
 * The prototype shell.
 *
 * Owns exactly three pieces of state: which view is showing, whether the rail
 * is open, and which palette is active. Everything below reads colour through
 * the CSS variables the active preset writes onto this element.
 * ------------------------------------------------------------------------ */

const GLOBAL_CSS = `
.vp-root ::selection { background: var(--p-accent-tint); color: var(--p-text); }

.vp-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
.vp-scroll::-webkit-scrollbar-thumb {
  background: var(--p-line-2); border-radius: 99px;
  border: 3px solid transparent; background-clip: content-box;
}
.vp-scroll::-webkit-scrollbar-track { background: transparent; }

.vp-hover { transition: background .18s ease, color .18s ease, border-color .18s ease; }
.vp-hover:hover { background: var(--p-hover); color: var(--p-text); }

.vp-root button:focus-visible,
.vp-root input:focus-visible,
.vp-root textarea:focus-visible,
.vp-root [tabindex]:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--p-accent-ring);
  border-radius: 10px;
}

.vp-composer:focus-within {
  border-color: var(--p-accent-edge) !important;
  box-shadow: 0 0 0 3px var(--p-accent-ring), var(--p-elev) !important;
}

.vp-edge { transition: background .18s ease, border-color .18s ease, transform .18s ease; }
.vp-edge:hover {
  background: var(--p-accent) !important;
  border-color: var(--p-accent) !important;
  color: var(--p-on-accent) !important;
}

.vp-tip { transition: opacity .18s ease; }
.vp-hover:hover .vp-tip, .vp-hover:focus-visible .vp-tip { opacity: 1; }

@keyframes vp-rise { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: none; } }
.vp-rise { opacity: 0; animation: vp-rise .46s cubic-bezier(.32,.72,0,1) forwards; }

@keyframes vp-blur { from { opacity: 0; filter: blur(4px); } to { opacity: 1; filter: blur(0); } }
.vp-blur { opacity: 0; animation: vp-blur .2s ease forwards; }

@keyframes vp-spin { to { transform: rotate(360deg); } }
.vp-spin { animation: vp-spin 1s linear infinite; }

@keyframes vp-flow { from { background-position: 0 0; } to { background-position: 20px 0; } }
.vp-flow { animation: vp-flow .9s linear infinite; }

@media (prefers-reduced-motion: reduce) {
  .vp-rise, .vp-blur { opacity: 1; animation: none; transform: none; filter: none; }
  .vp-spin, .vp-flow { animation: none; }
  .vp-root * { transition-duration: .01ms !important; }
}
`;

function PalettePicker({ preset, onPick }: { preset: Preset; onPick: (id: Preset['id']) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="vp-hover flex items-center gap-2.5 rounded-xl pl-2.5 pr-3 py-2"
        style={{ background: 'var(--p-card)', border: '1px solid var(--p-line)', color: 'var(--p-text)' }}
      >
        <span className="flex items-center gap-[3px] shrink-0" aria-hidden="true">
          {preset.swatch.map((c) => (
            <span
              key={c}
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: c, border: '1px solid var(--p-line-2)' }}
            />
          ))}
        </span>
        <span className="text-[12.5px] font-bold whitespace-nowrap" style={{ letterSpacing: '-.012em' }}>
          {preset.name}
        </span>
        <Palette className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} style={{ color: 'var(--p-text-2)' }} />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Colour palette"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[290px] rounded-2xl p-1.5"
          style={{
            background: 'var(--p-bg-2)',
            border: '1px solid var(--p-line)',
            boxShadow: 'var(--p-elev-2)',
          }}
        >
          {PRESETS.map((p) => {
            const on = p.id === preset.id;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  onPick(p.id);
                  setOpen(false);
                }}
                className="vp-hover w-full flex items-start gap-3 rounded-xl px-2.5 py-2.5 text-left"
                style={{ background: on ? 'var(--p-accent-tint)' : 'transparent' }}
              >
                <span
                  className="flex items-center gap-[3px] shrink-0 mt-[3px]"
                  aria-hidden="true"
                >
                  {p.swatch.map((c) => (
                    <span
                      key={c}
                      className="w-3 h-3 rounded-full"
                      style={{ background: c, border: '1px solid var(--p-line-2)' }}
                    />
                  ))}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-bold" style={{ color: 'var(--p-text)' }}>
                    {p.name}
                  </span>
                  <span className="block text-[11.5px] font-semibold leading-[1.45] mt-0.5" style={{ color: 'var(--p-text-2)' }}>
                    {p.blurb}
                  </span>
                </span>
                {on ? <Check className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={2.6} style={{ color: 'var(--p-accent-2)' }} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const VIEW_META: Record<ViewId, { title: string; meta: string }> = {
  trace: { title: 'Paid search CAC — the May drift', meta: 'TRACED 06:14 · 4 SOURCES' },
  workflows: { title: 'Workflow Hub', meta: '2 RUNNING · 4 QUEUED' },
  dossier: { title: 'Dossier Storage', meta: '8 OF 11 FIELDS KNOWN' },
  connections: { title: 'Data Connections', meta: '5 CONNECTED · 1 NEEDS ATTENTION' },
};

export function VeraPrototype() {
  const { preset, setPreset } = usePreset();
  const [view, setView] = useState<ViewId>('trace');
  const [open, setOpen] = useState(readSidebarOpen);

  const toggleSidebar = () => {
    setOpen((v) => {
      writeSidebarOpen(!v);
      return !v;
    });
  };

  const meta = VIEW_META[view];
  const activeNav = NAV.find((n) => n.id === view);

  return (
    <div
      className="vp-root fixed inset-0 flex overflow-hidden"
      style={{
        ...(preset.vars as Record<string, string>),
        background: 'var(--p-bg)',
        color: 'var(--p-text)',
        colorScheme: preset.scheme,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif',
        letterSpacing: '-.021em',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <style>{GLOBAL_CSS}</style>

      {/* Static atmosphere — a fixed wash plus grain. Nothing animates here. */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'var(--p-wash)' }} aria-hidden="true" />
      <div
        className="absolute inset-0 pointer-events-none z-[60]"
        aria-hidden="true"
        style={{
          opacity: 'var(--p-grain)',
          mixBlendMode: 'var(--p-grain-blend)' as never,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <Sidebar open={open} view={view} onView={setView} onToggle={toggleSidebar} />

      <div className="relative z-10 flex-1 min-w-0 flex flex-col">
        <header
          className="shrink-0 flex items-center gap-4 h-[60px] px-6"
          style={{ borderBottom: '1px solid var(--p-line)' }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              {activeNav ? (
                <activeNav.icon className="w-4 h-4 shrink-0" strokeWidth={2.2} style={{ color: 'var(--p-accent-2)' }} />
              ) : null}
              <h1
                className="m-0 text-[14px] font-bold truncate"
                style={{ color: 'var(--p-text)', letterSpacing: '-.02em' }}
              >
                {meta.title}
              </h1>
            </div>
            <div
              className="text-[10.5px] font-bold mt-0.5"
              style={{ fontFamily: MONO, letterSpacing: '.1em', color: 'var(--p-text-2)' }}
            >
              {meta.meta}
            </div>
          </div>

          <div className="flex-1" />

          <span className="hidden lg:block">
            <StatusPill tone="ok">Goal · CAC under $450 by 30 Sep</StatusPill>
          </span>

          <PalettePicker preset={preset} onPick={setPreset} />
        </header>

        <main className="flex-1 min-h-0">
          {view === 'trace' ? <CausalTrace /> : null}
          {view === 'workflows' ? <WorkflowHub /> : null}
          {view === 'dossier' ? <DossierStorage /> : null}
          {view === 'connections' ? <DataConnections /> : null}
        </main>
      </div>
    </div>
  );
}

export default VeraPrototype;
