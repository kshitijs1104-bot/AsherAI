import { useCallback, useEffect, useState } from 'react';

/* ---------------------------------------------------------------------------
 * The palette engine.
 *
 * Every preset fills the SAME variable contract — nothing in the prototype
 * reads a colour that isn't listed here, and no component knows which preset
 * is active. Adding a fifth palette is one entry in PRESETS and zero component
 * changes.
 *
 * Store shape (module-level value + explicit subscriber set + a `storage`
 * listener) deliberately mirrors lib/venusTheme.ts so both preferences behave
 * identically across mounted surfaces and browser tabs.
 * ------------------------------------------------------------------------ */

export type PresetId = 'deep-tech' | 'midnight' | 'executive' | 'nordic';

export interface Preset {
  id: PresetId;
  name: string;
  blurb: string;
  scheme: 'dark' | 'light';
  /** Three dots shown in the switcher: canvas, surface, accent. */
  swatch: [string, string, string];
  vars: Record<string, string>;
}

/* Contrast note on --p-text-3: it is the dimmest token in the system and is
   used only for decorative rules and disabled controls — never for a label,
   a value, a timestamp or a status. Every one of those reads --p-text-2 or
   brighter, which clears 7:1 against its own canvas in all four presets. */

export const PRESETS: Preset[] = [
  {
    id: 'deep-tech',
    name: 'Deep Tech',
    blurb: 'Slate canvas, blurred glass, violet markers',
    scheme: 'dark',
    swatch: ['#020617', '#1E293B', '#8B5CF6'],
    vars: {
      '--p-bg': '#020617',
      '--p-bg-2': '#0B1220',
      '--p-glass': 'rgba(15,23,42,.55)',
      '--p-card': 'rgba(255,255,255,.055)',
      '--p-card-2': 'rgba(255,255,255,.032)',
      '--p-line': 'rgba(255,255,255,.12)',
      '--p-line-2': 'rgba(255,255,255,.20)',
      '--p-hover': 'rgba(255,255,255,.07)',
      '--p-text': '#F1F5F9',
      '--p-text-2': '#CBD5E1',
      '--p-text-3': '#94A3B8',
      '--p-accent': '#8B5CF6',
      '--p-accent-2': '#C4B5FD',
      '--p-accent-tint': 'rgba(139,92,246,.16)',
      '--p-accent-edge': 'rgba(139,92,246,.48)',
      '--p-accent-ring': 'rgba(139,92,246,.32)',
      '--p-on-accent': '#FFFFFF',
      '--p-ok': '#34D399',
      '--p-warn': '#FBBF24',
      '--p-crit': '#FB7185',
      '--p-wash': 'radial-gradient(90% 60% at 16% -12%, rgba(139,92,246,.15), transparent 62%), radial-gradient(70% 50% at 94% 6%, rgba(56,189,248,.09), transparent 64%)',
      '--p-elev': '0 1px 3px rgba(2,6,23,.55), 0 12px 32px -18px rgba(2,6,23,.75)',
      '--p-elev-2': '0 12px 40px -12px rgba(2,6,23,.85)',
      '--p-sx-key': '#C4B5FD',
      '--p-sx-str': '#A3BE8C',
      '--p-sx-num': '#F0A9C8',
      '--p-sx-bool': '#EBCB8B',
      '--p-sx-punct': '#94A3B8',
      '--p-sx-bg': 'rgba(2,6,23,.60)',
      '--p-grain': '.030',
      '--p-grain-blend': 'overlay',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight Minimalist',
    blurb: 'Matte black, graphite, surgical cyan',
    scheme: 'dark',
    swatch: ['#08090A', '#1C1D20', '#22D3EE'],
    vars: {
      '--p-bg': '#08090A',
      '--p-bg-2': '#101113',
      '--p-glass': 'rgba(16,17,19,.62)',
      '--p-card': 'rgba(255,255,255,.042)',
      '--p-card-2': 'rgba(255,255,255,.026)',
      '--p-line': 'rgba(255,255,255,.10)',
      '--p-line-2': 'rgba(255,255,255,.18)',
      '--p-hover': 'rgba(255,255,255,.06)',
      '--p-text': '#FAFAFA',
      '--p-text-2': '#D4D4D8',
      '--p-text-3': '#A1A1AA',
      '--p-accent': '#22D3EE',
      '--p-accent-2': '#67E8F9',
      '--p-accent-tint': 'rgba(34,211,238,.13)',
      '--p-accent-edge': 'rgba(34,211,238,.45)',
      '--p-accent-ring': 'rgba(34,211,238,.28)',
      '--p-on-accent': '#04181C',
      '--p-ok': '#4ADE80',
      '--p-warn': '#FACC15',
      '--p-crit': '#F87171',
      '--p-wash': 'radial-gradient(80% 50% at 50% -10%, rgba(255,255,255,.045), transparent 60%)',
      '--p-elev': '0 1px 2px rgba(0,0,0,.7), 0 10px 30px -20px rgba(0,0,0,.9)',
      '--p-elev-2': '0 14px 44px -14px rgba(0,0,0,.92)',
      '--p-sx-key': '#67E8F9',
      '--p-sx-str': '#A7D2A0',
      '--p-sx-num': '#E3A7C8',
      '--p-sx-bool': '#EBCB8B',
      '--p-sx-punct': '#A1A1AA',
      '--p-sx-bg': 'rgba(0,0,0,.55)',
      '--p-grain': '.026',
      '--p-grain-blend': 'overlay',
    },
  },
  {
    id: 'executive',
    name: 'Executive Light',
    blurb: 'Paper canvas, charcoal type, midnight blue',
    scheme: 'light',
    swatch: ['#F8FAFC', '#FFFFFF', '#1E3A8A'],
    vars: {
      '--p-bg': '#F8FAFC',
      '--p-bg-2': '#FFFFFF',
      '--p-glass': 'rgba(255,255,255,.78)',
      '--p-card': '#FFFFFF',
      '--p-card-2': '#F8FAFC',
      '--p-line': 'rgba(15,23,42,.13)',
      '--p-line-2': 'rgba(15,23,42,.22)',
      '--p-hover': 'rgba(15,23,42,.05)',
      '--p-text': '#0B1220',
      '--p-text-2': '#334155',
      '--p-text-3': '#64748B',
      '--p-accent': '#1E3A8A',
      '--p-accent-2': '#1E40AF',
      '--p-accent-tint': 'rgba(30,58,138,.08)',
      '--p-accent-edge': 'rgba(30,58,138,.32)',
      '--p-accent-ring': 'rgba(30,58,138,.22)',
      '--p-on-accent': '#FFFFFF',
      '--p-ok': '#047857',
      '--p-warn': '#B45309',
      '--p-crit': '#B91C1C',
      '--p-wash': 'radial-gradient(90% 60% at 14% -14%, rgba(30,58,138,.07), transparent 60%), radial-gradient(60% 45% at 96% 4%, rgba(15,23,42,.05), transparent 62%)',
      '--p-elev': '0 1px 2px rgba(15,23,42,.07), 0 12px 28px -16px rgba(15,23,42,.22)',
      '--p-elev-2': '0 18px 44px -16px rgba(15,23,42,.30)',
      '--p-sx-key': '#1E3A8A',
      '--p-sx-str': '#3F6212',
      '--p-sx-num': '#86198F',
      '--p-sx-bool': '#92400E',
      '--p-sx-punct': '#64748B',
      '--p-sx-bg': '#F1F5F9',
      '--p-grain': '.038',
      '--p-grain-blend': 'multiply',
    },
  },
  {
    id: 'nordic',
    name: 'Nordic Sage',
    blurb: 'Stone canvas, forest green, pine states',
    scheme: 'dark',
    swatch: ['#171A19', '#2A302C', '#6FAE8B'],
    vars: {
      '--p-bg': '#171A19',
      '--p-bg-2': '#1E2422',
      '--p-glass': 'rgba(30,36,34,.62)',
      '--p-card': 'rgba(236,244,239,.055)',
      '--p-card-2': 'rgba(236,244,239,.032)',
      '--p-line': 'rgba(226,238,231,.13)',
      '--p-line-2': 'rgba(226,238,231,.22)',
      '--p-hover': 'rgba(236,244,239,.07)',
      '--p-text': '#ECF1ED',
      '--p-text-2': '#C6D2C9',
      '--p-text-3': '#94A39A',
      '--p-accent': '#6FAE8B',
      '--p-accent-2': '#9FD3B6',
      '--p-accent-tint': 'rgba(111,174,139,.15)',
      '--p-accent-edge': 'rgba(111,174,139,.45)',
      '--p-accent-ring': 'rgba(111,174,139,.30)',
      '--p-on-accent': '#0B1710',
      '--p-ok': '#7FC79E',
      '--p-warn': '#D9A441',
      '--p-crit': '#DE8878',
      '--p-wash': 'radial-gradient(85% 55% at 18% -12%, rgba(111,174,139,.12), transparent 62%), radial-gradient(65% 45% at 92% 8%, rgba(120,140,130,.08), transparent 64%)',
      '--p-elev': '0 1px 3px rgba(6,12,9,.5), 0 12px 32px -18px rgba(6,12,9,.7)',
      '--p-elev-2': '0 14px 42px -14px rgba(6,12,9,.8)',
      '--p-sx-key': '#9FD3B6',
      '--p-sx-str': '#BFD5A8',
      '--p-sx-num': '#D8B4C4',
      '--p-sx-bool': '#E0C48A',
      '--p-sx-punct': '#94A39A',
      '--p-sx-bg': 'rgba(10,16,13,.55)',
      '--p-grain': '.032',
      '--p-grain-blend': 'overlay',
    },
  },
];

export const DEFAULT_PRESET: PresetId = 'deep-tech';

export function getPreset(id: PresetId): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
}

const KEY = 've_prototype_preset';

function isPresetId(value: string | null): value is PresetId {
  return value != null && PRESETS.some((p) => p.id === value);
}

function read(): PresetId {
  try {
    const stored = localStorage.getItem(KEY);
    return isPresetId(stored) ? stored : DEFAULT_PRESET;
  } catch {
    return DEFAULT_PRESET;
  }
}

let current: PresetId = read();
const listeners = new Set<(id: PresetId) => void>();

export function getCurrentPreset(): PresetId {
  return current;
}

export function setPreset(id: PresetId) {
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Private-browsing tabs just lose the preference on reload. Harmless.
  }
  listeners.forEach((fn) => fn(id));
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY) return;
    const next = isPresetId(event.newValue) ? event.newValue : DEFAULT_PRESET;
    current = next;
    listeners.forEach((fn) => fn(next));
  });
}

export function usePreset() {
  const [id, setLocal] = useState<PresetId>(current);

  useEffect(() => {
    listeners.add(setLocal);
    setLocal(current);
    return () => {
      listeners.delete(setLocal);
    };
  }, []);

  const select = useCallback((next: PresetId) => setPreset(next), []);

  return { presetId: id, preset: getPreset(id), setPreset: select };
}

/* Sidebar open/closed survives reloads too — a founder who works collapsed
   should not have to re-collapse it every morning. */
const SB_KEY = 've_prototype_sidebar';

export function readSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SB_KEY) !== 'closed';
  } catch {
    return true;
  }
}

export function writeSidebarOpen(open: boolean) {
  try {
    localStorage.setItem(SB_KEY, open ? 'open' : 'closed');
  } catch {
    // Same best-effort contract as above.
  }
}
