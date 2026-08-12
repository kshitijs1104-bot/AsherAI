import { useCallback, useEffect, useState } from 'react';

// Which visual identity Vera renders in. Three of them, and every one is a
// designed system rather than a colourway — each ships its own light and dark
// reading, not a dimmed copy of the other.
//
//   deep     — Deep Tech. Indigo and violet on a slate near-black, or on cool
//              paper. The default.
//   midnight — Midnight Minimalist. Matte graphite, thin rules, steel blue.
//              Tighter radii than the other two; the most restrained.
//   nordic   — Nordic Green. A slate-stone canvas with muted pine.
//
// This replaces the previous alloy/vessel/classic set. `classic` in particular
// is gone on purpose: it was defined as the ABSENCE of a data-skin attribute,
// which meant the untouched pre-redesign look was reachable and, being nobody's
// deliberate design, was what most sessions actually saw. There is no longer a
// state in which the product renders unstyled.
export type VeraSkin = 'deep' | 'midnight' | 'nordic';

export const VERA_SKINS: VeraSkin[] = ['deep', 'midnight', 'nordic'];

// What a founder is shown when choosing. Deliberately describes how each one
// looks — nothing about who it's for. Two people looking at the same screen
// should be choosing between three designs, not being sorted.
export const SKIN_META: Record<VeraSkin, { name: string; line: string; detail: string }> = {
  deep: {
    name: 'Deep Tech',
    line: 'Indigo on near-black',
    detail: 'A slate ground with indigo and violet light behind it. The most atmospheric of the three, and the one that looks most like the product thinking.',
  },
  midnight: {
    name: 'Midnight Minimalist',
    line: 'Matte graphite, steel blue',
    detail: 'Flat black, hairline rules and tight corners. Nothing glows and nothing is rounded off — the closest thing here to a precision instrument.',
  },
  nordic: {
    name: 'Nordic Green',
    line: 'Stone and muted pine',
    detail: 'A low-fatigue slate-stone canvas with pine accents. The quietest palette, made for long sessions rather than first impressions.',
  },
};

const SKIN_KEY = 've_skin';

// Applied before anyone has chosen. Unlike the previous default this is a real
// designed identity, so a first-run session sees the product as intended
// rather than as its own fallback.
const DEFAULT_SKIN: VeraSkin = 'deep';

function isSkin(value: unknown): value is VeraSkin {
  return value === 'deep' || value === 'midnight' || value === 'nordic';
}

/** The stored choice, or null when the founder has never been asked. */
export function readStoredSkin(): VeraSkin | null {
  try {
    const raw = localStorage.getItem(SKIN_KEY);
    return isSkin(raw) ? raw : null;
  } catch {
    // Private-browsing tabs with no localStorage fall through to the default
    // and simply get asked again next visit, which is harmless.
    return null;
  }
}

// A tab with no usable localStorage (private browsing, storage disabled)
// can never record a choice, so readStoredSkin() would keep returning null
// and the first-run dialog would reappear on every reload — the one screen
// that must only ever be seen once. This in-memory flag closes that: the
// preference still won't survive the session, but the interruption doesn't
// repeat within it.
let answeredThisSession = false;

export function hasChosenSkin(): boolean {
  return answeredThisSession || readStoredSkin() !== null;
}

/**
 * Stamps the skin onto <html>. Every skin rule in index.css is scoped to
 * `html[data-skin="…"]`, so this one attribute is the whole switch — no
 * component re-render is needed for the visual change itself, only for the
 * controls that display the current choice.
 *
 * Unlike the previous version there is no branch that REMOVES the attribute:
 * all three identities are real, so the attribute is always present and the
 * bare `:root` tokens now only ever act as a fallback that nothing reaches.
 */
export function applySkin(skin: VeraSkin) {
  document.documentElement.setAttribute('data-skin', skin);
}

// One module-level source of truth with explicit subscribers. Without this,
// each component calling the hook would hold its own useState and changing
// the skin in Settings would leave every other mounted surface displaying the
// old value until it happened to remount.
let current: VeraSkin = readStoredSkin() ?? DEFAULT_SKIN;
const listeners = new Set<(skin: VeraSkin) => void>();

export function getSkin(): VeraSkin {
  return current;
}

export function setSkin(skin: VeraSkin) {
  current = skin;
  answeredThisSession = true;
  try {
    localStorage.setItem(SKIN_KEY, skin);
  } catch {
    // Preference won't survive the session; the applied skin below still does.
  }
  applySkin(skin);
  listeners.forEach((fn) => fn(skin));
}

// Run at import time, before React renders, so the correct skin is on <html>
// for the very first paint and there is no flash of the wrong palette.
applySkin(current);

// Another tab changing the choice should not leave this one out of step.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== SKIN_KEY) return;
    const next = isSkin(event.newValue) ? event.newValue : DEFAULT_SKIN;
    current = next;
    applySkin(next);
    listeners.forEach((fn) => fn(next));
  });
}

export function useVeraSkin() {
  const [skin, setLocal] = useState<VeraSkin>(current);

  useEffect(() => {
    listeners.add(setLocal);
    // Re-sync on mount in case the skin changed between render and effect.
    setLocal(current);
    return () => {
      listeners.delete(setLocal);
    };
  }, []);

  const choose = useCallback((next: VeraSkin) => setSkin(next), []);

  return { skin, setSkin: choose };
}
