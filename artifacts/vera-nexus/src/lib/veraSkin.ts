import { useCallback, useEffect, useState } from 'react';

// Which visual system Vera renders in. Two designed skins plus the untouched
// original, so a founder who doesn't like either can put the product back
// exactly as it was — and so can we, by changing DEFAULT_SKIN below.
//
//   classic — the pre-redesign look. Every rule that produces it still lives
//             in index.css untouched; the skins are additive overrides layered
//             on top, never replacements. Selecting this applies no overrides
//             at all, so it is the original by construction rather than by
//             a reimplementation that could drift.
//   alloy   — engineered instrument. Hierarchy from depth and hairline
//             structure; graphite/stone grounds, brass accent.
//   vessel  — tactile study. Hierarchy from scale; espresso/limewash grounds,
//             verdigris accent with aubergine reserved for Vera's unprompted
//             follow-ups.
export type VeraSkin = 'classic' | 'alloy' | 'vessel';

export const VERA_SKINS: VeraSkin[] = ['alloy', 'vessel', 'classic'];

// What a founder is shown when choosing. Deliberately describes how each one
// looks and behaves — nothing about who it's for. Two people looking at the
// same screen should be choosing between two designs, not being sorted.
export const SKIN_META: Record<VeraSkin, { name: string; line: string; detail: string }> = {
  alloy: {
    name: 'Alloy',
    line: 'Engineered and dense',
    detail: 'Precise hairlines, tight corners and keys that travel under the finger. What needs you is the panel sitting highest off the page.',
  },
  vessel: {
    name: 'Vessel',
    line: 'Warm and unhurried',
    detail: 'Generous curves, deep soft shadows and an editorial serif. What needs you is simply the largest thing on the page.',
  },
  classic: {
    name: 'Classic',
    line: 'The original Vera',
    detail: 'Exactly how Vera looked before the redesign. Nothing is overridden.',
  },
};

const SKIN_KEY = 've_skin';

// Applied when nobody has chosen yet. Kept at 'classic' on purpose: until a
// founder picks, the product looks precisely as it did, so shipping the skins
// cannot change anything for anyone who hasn't opted in. Flip this to 'alloy'
// or 'vessel' to change the out-of-the-box default once one has been picked.
const DEFAULT_SKIN: VeraSkin = 'classic';

function isSkin(value: unknown): value is VeraSkin {
  return value === 'classic' || value === 'alloy' || value === 'vessel';
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
 */
export function applySkin(skin: VeraSkin) {
  const root = document.documentElement;
  if (skin === 'classic') {
    // No attribute at all rather than data-skin="classic", so classic is the
    // absence of overrides and cannot accidentally pick any up.
    root.removeAttribute('data-skin');
  } else {
    root.setAttribute('data-skin', skin);
  }
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
