import { useEffect, useState } from 'react';
import { Plug, Palette, X } from 'lucide-react';
import { ConnectorPicker } from './ConnectorPicker';
import { SkinChoiceList } from './SkinPicker';
import type { VenusTheme } from '../lib/venusTheme';

type Tab = 'connectors' | 'appearance';

/**
 * Vera's sidebar Settings button used to expand an inline panel at the
 * bottom of the 260px-wide, fixed-height aside — which has no scroll
 * container of its own (`h-screen`, no `overflow-y-auto`). Connectors plus
 * the three-row Appearance list pushed the panel's bottom past the
 * viewport with nothing to scroll it back into view; the only way to reach
 * "Classic" at the bottom of the list was to zoom the whole page out.
 *
 * A centered popup sidesteps that entirely: it isn't laid out inside the
 * sidebar's column at all, and its own body scrolls independently of
 * anything else on screen, so it can never be pushed off-frame by how much
 * content either tab holds.
 */
export function VeraSettingsModal({
  open,
  onClose,
  theme,
}: {
  open: boolean;
  onClose: () => void;
  theme: VenusTheme;
}) {
  const [tab, setTab] = useState<Tab>('connectors');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Reopening always lands back on Connectors — the more frequent reason
  // to open this — rather than wherever it was left last time.
  useEffect(() => {
    if (open) setTab('connectors');
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={theme === 'light' ? 'v7-light' : ''}
      role="dialog"
      aria-modal="true"
      aria-labelledby="vera-settings-title"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'grid',
        placeItems: 'center',
        padding: '20px',
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '420px',
          maxHeight: 'min(600px, 85vh)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--v7-bg-raised)',
          border: '1px solid var(--v7-border-strong)',
          borderRadius: '16px',
          boxShadow: '0 40px 90px -30px rgba(0,0,0,0.7)',
          fontFamily: 'var(--v7-font-round)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '16px 16px 12px 20px',
            flexShrink: 0,
          }}
        >
          <h2
            id="vera-settings-title"
            style={{ fontSize: '15px', fontWeight: 700, color: 'var(--v7-text)', margin: 0, letterSpacing: '-0.01em' }}
          >
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-1.5 rounded-lg"
            style={{ color: 'var(--v7-text-mute)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--v7-text)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--v7-text-mute)')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Settings section"
          style={{
            display: 'flex',
            gap: '2px',
            margin: '0 20px 14px',
            padding: '3px',
            borderRadius: '10px',
            background: 'var(--v7-bg-raised-2)',
            border: '1px solid var(--v7-border)',
            flexShrink: 0,
          }}
        >
          {(
            [
              { id: 'connectors' as const, label: 'Connectors', icon: Plug },
              { id: 'appearance' as const, label: 'Appearance', icon: Palette },
            ]
          ).map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(id)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '8px 10px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  borderRadius: '7px',
                  border: 'none',
                  cursor: 'pointer',
                  color: active ? 'var(--v7-text)' : 'var(--v7-text-mute)',
                  background: active ? 'var(--v7-bg-raised)' : 'transparent',
                  boxShadow: active ? '0 1px 2px rgba(0,0,0,0.15)' : 'none',
                  transition: 'color 140ms ease, background 140ms ease',
                }}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            );
          })}
        </div>

        {/* The one part of this dialog that scrolls. Whatever either tab
            holds — more connectors added later, a fourth skin — stays
            reachable by scrolling the popup, never by scrolling or zooming
            the page behind it. */}
        <div style={{ overflowY: 'auto', padding: '0 20px 20px' }}>
          {tab === 'connectors' ? (
            <ConnectorPicker />
          ) : (
            <SkinChoiceList />
          )}
        </div>
      </div>
    </div>
  );
}
