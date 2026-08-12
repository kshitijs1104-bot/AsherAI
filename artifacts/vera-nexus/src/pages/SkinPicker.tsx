import { useEffect, useState } from 'react';
import { SKIN_META, VERA_SKINS, hasChosenSkin, setSkin, useVeraSkin, type VeraSkin } from '../lib/veraSkin';
import { useVenusTheme } from '../lib/venusTheme';

/**
 * The compact form, for Vera's own settings panel in the sidebar (260px wide,
 * so this is a vertical stack rather than the dialog's side-by-side tiles).
 * Lives here beside the dialog because both read the same SKIN_META and must
 * describe the skins identically — a founder who picked "Vessel" on day one
 * should find the same words when they go looking for it later.
 *
 * Light/dark is deliberately absent: the sidebar header already carries that
 * toggle a few pixels above this panel, and offering it twice in one column
 * invites the reading that they are two different settings.
 */
export function SkinChoiceList() {
  const { skin, setSkin: choose } = useVeraSkin();

  return (
    <div style={{ display: 'grid', gap: '4px' }}>
      {VERA_SKINS.map((option) => {
        const meta = SKIN_META[option];
        const active = skin === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => choose(option)}
            aria-pressed={active}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              width: '100%',
              textAlign: 'left',
              padding: '8px 9px',
              borderRadius: '8px',
              background: active ? 'var(--v7-cyan-soft)' : 'transparent',
              border: `1px solid ${active ? 'var(--v7-cyan-strong)' : 'transparent'}`,
              cursor: 'pointer',
              transition: 'background 140ms ease, border-color 140ms ease',
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = 'var(--v7-bg-raised)';
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = 'transparent';
            }}
          >
            {/* A filled dot in the accent is the whole selected-state signal —
                at this width a check glyph plus a label wraps the line. */}
            <span
              aria-hidden="true"
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                marginTop: '5px',
                flexShrink: 0,
                background: active ? 'var(--v7-cyan)' : 'transparent',
                border: active ? 'none' : '1px solid var(--v7-border-strong)',
              }}
            />
            <span style={{ display: 'grid', gap: '1px', minWidth: 0 }}>
              <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--v7-text)', lineHeight: 1.3 }}>
                {meta.name}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--v7-text-mute)', lineHeight: 1.35 }}>
                {meta.line}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const DISPLAY_STACK = '"Segoe UI Variable Display", "SF Pro Display", -apple-system, system-ui, sans-serif';
const BODY_STACK = '"Segoe UI Variable Text", "SF Pro Text", -apple-system, system-ui, sans-serif';

// Swatches for the preview tiles. These are literal values rather than reads
// of the live custom properties on purpose: a tile has to show what an
// identity looks like while a *different* one is active, and a var() would
// resolve to whichever is currently applied. They mirror the token blocks in
// index.css — if those move, these move with them.
const PREVIEW: Record<
  VeraSkin,
  Record<'dark' | 'light', { ground: string; card: string; edge: string; text: string; dim: string; accent: string; accentInk: string }>
> = {
  deep: {
    dark: { ground: '#06070D', card: '#0E1017', edge: 'rgba(230,235,245,0.10)', text: '#EDEFF5', dim: '#99A2B4', accent: '#7C88F0', accentInk: '#0B0E1C' },
    light: { ground: '#F7F8FB', card: '#FFFFFF', edge: '#E1E5EE', text: '#10131C', dim: '#4B5265', accent: '#4149BE', accentInk: '#FFFFFF' },
  },
  midnight: {
    dark: { ground: '#08090A', card: '#121314', edge: 'rgba(255,255,255,0.095)', text: '#F4F4F5', dim: '#A0A2A8', accent: '#7FB6C8', accentInk: '#06171C' },
    light: { ground: '#FAFAFA', card: '#FFFFFF', edge: '#E4E4E5', text: '#0C0D0E', dim: '#4F5258', accent: '#27606F', accentInk: '#FFFFFF' },
  },
  nordic: {
    dark: { ground: '#101614', card: '#18201D', edge: 'rgba(224,238,230,0.10)', text: '#E9EFEB', dim: '#9AA89F', accent: '#82B295', accentInk: '#08120E' },
    light: { ground: '#F6F8F6', card: '#FFFFFF', edge: '#E0E7E2', text: '#101613', dim: '#49534C', accent: '#35604A', accentInk: '#FFFFFF' },
  },
};

// All three identities share one type system, so the preview only varies the
// radius — the one geometric thing that actually differs between them
// (Midnight runs tighter corners than the other two).
const PREVIEW_FONT: Record<VeraSkin, { display: string; body: string; radius: number; cardRadius: number }> = {
  deep: { display: DISPLAY_STACK, body: BODY_STACK, radius: 8, cardRadius: 10 },
  midnight: { display: DISPLAY_STACK, body: BODY_STACK, radius: 6, cardRadius: 8 },
  nordic: { display: DISPLAY_STACK, body: BODY_STACK, radius: 8, cardRadius: 10 },
};

function SkinTile({
  skin,
  theme,
  selected,
  onSelect,
}: {
  skin: VeraSkin;
  theme: 'dark' | 'light';
  selected: boolean;
  onSelect: () => void;
}) {
  const c = PREVIEW[skin][theme];
  const f = PREVIEW_FONT[skin];
  const meta = SKIN_META[skin];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        display: 'grid',
        gap: '14px',
        textAlign: 'left',
        padding: '14px',
        borderRadius: `${f.cardRadius}px`,
        background: 'var(--v7-bg-raised)',
        border: `1px solid ${selected ? 'var(--v7-cyan)' : 'var(--v7-border-strong)'}`,
        boxShadow: selected ? '0 0 0 3px var(--v7-cyan-soft)' : 'none',
        cursor: 'pointer',
        transition: 'border-color 160ms ease, box-shadow 160ms ease',
      }}
    >
      {/* Miniature of the skin: ground, a card set into it, a key. */}
      <div
        aria-hidden="true"
        style={{
          background: c.ground,
          borderRadius: `${f.radius}px`,
          padding: '16px',
          display: 'grid',
          gap: '10px',
          border: `1px solid ${c.edge}`,
        }}
      >
        <div style={{ fontFamily: f.display, fontSize: '17px', fontWeight: 650, color: c.text, letterSpacing: '-0.028em', lineHeight: 1.2 }}>
          Four things need you
        </div>
        <div
          style={{
            background: c.card,
            border: `1px solid ${c.edge}`,
            borderRadius: `${f.cardRadius - 4}px`,
            padding: '12px',
            display: 'grid',
            gap: '8px',
          }}
        >
          <div style={{ fontFamily: f.body, fontSize: '11.5px', fontWeight: 600, color: c.text, lineHeight: 1.3 }}>
            Reply to Kettle &amp; Co about wholesale
          </div>
          <div style={{ fontFamily: f.body, fontSize: '10.5px', color: c.dim, lineHeight: 1.4 }}>
            Drafted 06:12 from your last three replies.
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', paddingTop: '2px' }}>
            <span
              style={{
                background: c.accent,
                color: c.accentInk,
                fontFamily: f.body,
                fontSize: '10px',
                fontWeight: 600,
                padding: '5px 11px',
                borderRadius: '999px',
              }}
            >
              Approve
            </span>
            <span style={{ fontFamily: f.body, fontSize: '10px', color: c.dim }}>Dismiss</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: '3px', padding: '0 4px 4px' }}>
        <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--v7-text)' }}>{meta.name}</span>
        <span style={{ fontSize: '12.5px', color: 'var(--v7-cyan)', fontWeight: 500 }}>{meta.line}</span>
        <span style={{ fontSize: '12.5px', color: 'var(--v7-text-mute)', lineHeight: 1.5 }}>{meta.detail}</span>
      </div>
    </button>
  );
}

/**
 * Shown once, the first time someone opens Vera, and never again after a
 * choice is stored. Selecting a tile applies the skin immediately rather than
 * on confirm, so the app behind the dialog is the actual preview — the tiles
 * only have to get someone close enough to want to look.
 *
 * There is no default selection and no way to end up somewhere by accident:
 * closing without picking keeps the current look and asks again next time.
 */
export function SkinPicker() {
  const { theme } = useVenusTheme();
  const { skin } = useVeraSkin();
  const [open, setOpen] = useState(() => !hasChosenSkin());
  // What the skin was before the dialog opened, so dismissing can put it back
  // if someone tried one on and then changed their mind.
  const [entrySkin] = useState<VeraSkin>(skin);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setSkin(entrySkin);
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, entrySkin]);

  if (!open) return null;

  const confirm = (choice: VeraSkin) => {
    setSkin(choice);
    setOpen(false);
  };

  return (
    <div
      className={theme === 'light' ? 'v7-light' : ''}
      role="dialog"
      aria-modal="true"
      aria-labelledby="skin-picker-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'grid',
        placeItems: 'center',
        padding: '20px',
        background: 'rgba(0,0,0,0.62)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '720px',
          background: 'var(--v7-bg)',
          border: '1px solid var(--v7-border-strong)',
          borderRadius: '20px',
          padding: '28px',
          display: 'grid',
          gap: '22px',
          boxShadow: '0 40px 90px -30px rgba(0,0,0,0.7)',
          fontFamily: 'var(--v7-font-round)',
        }}
      >
        <div style={{ display: 'grid', gap: '7px' }}>
          <span
            style={{
              fontFamily: 'var(--v7-font-mono)',
              fontSize: '10px',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--v7-text-mute)',
            }}
          >
            One-time setup
          </span>
          <h2 id="skin-picker-title" style={{ fontSize: '25px', fontWeight: 700, color: 'var(--v7-text)', margin: 0, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            Choose how Vera looks
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--v7-text-dim)', margin: 0, lineHeight: 1.55, maxWidth: '52ch' }}>
            Three designs, the same Vera underneath. Pick whichever you'd rather look
            at all day — you can switch any time in Settings.
          </p>
        </div>

        {/* Three tiles rather than two, and no "keep the original" escape hatch:
            every option here is a designed identity, so there is nothing to
            fall back to. minmax drops to 220px because three across needs more
            room than two did before it wraps. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '14px',
          }}
        >
          {VERA_SKINS.map((option) => (
            <SkinTile
              key={option}
              skin={option}
              theme={theme}
              selected={touched && skin === option}
              onSelect={() => {
                setTouched(true);
                setSkin(option);
              }}
            />
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '14px',
            flexWrap: 'wrap',
            paddingTop: '4px',
            borderTop: '1px solid var(--v7-border)',
          }}
        >
          <button
            type="button"
            className="vera-key vera-key-1"
            disabled={!touched}
            onClick={() => confirm(skin)}
            title={touched ? undefined : 'Pick one of the three above first'}
          >
            {touched ? `Use ${SKIN_META[skin].name}` : 'Pick one to continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
