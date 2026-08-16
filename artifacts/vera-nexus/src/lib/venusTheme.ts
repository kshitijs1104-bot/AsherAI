import { useCallback, useEffect, useState } from 'react';
import { prefStorage } from './cookieConsent';

// Vera-local theme preference — deliberately separate from the app-wide
// dark mode (Layout.tsx hardcodes `dark` unconditionally for the rest of
// the app, which is out of scope here). Same self-contained,
// best-effort localStorage pattern already used throughout this codebase
// (ve_show_goal_panel, ve_today_seen, ve_outcome_reminder_seen_*).
const KEY = 've_theme';

export type VenusTheme = 'dark' | 'light';

function readTheme(): VenusTheme {
  return prefStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
}

// Via prefStorage, not localStorage directly: the theme is an optional
// preference under the cookie banner, so this write is a no-op for anyone who
// chose "essential only". The in-memory value below still changes, so the
// toggle works for the session — it just doesn't persist, which is the same
// behaviour this function already had in a private-browsing tab.
function writeTheme(theme: VenusTheme) {
  prefStorage.setItem(KEY, theme);
}

// Previously each caller held its own useState seeded from localStorage, so
// the four Vera routes and the Settings control each tracked the theme
// independently: toggling on one surface left every other mounted surface
// showing the old value until it happened to remount. One module-level value
// with explicit subscribers keeps them in step, and mirrors the store in
// veraSkin.ts so both preferences behave the same way.
let current: VenusTheme = readTheme();
const listeners = new Set<(theme: VenusTheme) => void>();

export function getVenusTheme(): VenusTheme {
  return current;
}

export function setVenusTheme(theme: VenusTheme) {
  current = theme;
  writeTheme(theme);
  listeners.forEach((fn) => fn(theme));
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY) return;
    const next: VenusTheme = event.newValue === 'light' ? 'light' : 'dark';
    current = next;
    listeners.forEach((fn) => fn(next));
  });
}

export function useVenusTheme() {
  const [theme, setLocal] = useState<VenusTheme>(current);

  useEffect(() => {
    listeners.add(setLocal);
    setLocal(current);
    return () => {
      listeners.delete(setLocal);
    };
  }, []);

  const toggle = useCallback(() => {
    setVenusTheme(current === 'light' ? 'dark' : 'light');
  }, []);

  const set = useCallback((next: VenusTheme) => setVenusTheme(next), []);

  return { theme, toggle, setTheme: set };
}
