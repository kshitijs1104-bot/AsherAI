# Archived — the Vera Nexus terminal

This is the surface that used to live at `/` before the landing page took the
root: a market/causal-events terminal made of four screens plus its own chrome.

    Line      the causal event feed (was `/` and `/line`)
    Sight     the full-width news terminal with a watchlist (was `/sight`)
    Crypt     the graveyard (was `/crypt`)
    Thoughts  (was `/thoughts`)

Nothing here is imported by the running app. It is kept as source rather than
deleted so the work is readable without going through git, and so any part of
it can be brought back without being rebuilt.

## What moved, and what didn't

Everything in this folder was reachable **only** from the four screens above,
so the split is clean — the live app lost no code it was using:

    components/layout/    Topbar, LeftSidebar, RightSidebar, Layout
    lib/                  CategoryContext, sight-data, graveyard, watchlist
    hooks/                useWatchlist
    pages/sight/          the Sight screen's own components

Two things stayed behind on purpose:

- **`pages/Settings.tsx`** looks like Nexus chrome and its old comment said so,
  but its contents are Vera's: the business context sent with every request,
  and the read-only "What Vera Knows" company-memory list. Archiving it would
  have removed the only UI for editing either. It now renders standalone at
  `/settings`, behind the same auth gate as the rest of Vera.
- **`lib/enterpriseGate.ts`** is still used by App and the enterprise flow.
  `components/layout/Topbar.tsx` in here imports it via the `@/` alias for
  that reason — the only import in this tree that reaches outside it.

## Bringing a screen back

1. Register its route in `src/App.tsx` — the imports would be
   `@/_archive/pages/Line` and so on.
2. Screens other than Sight expect `<Layout>` (`@/_archive/components/layout/Layout`)
   and Layout's sidebars expect `CategoryProvider`
   (`@/_archive/lib/CategoryContext`) somewhere above them. `App.tsx` used to
   mount that provider at the root; it no longer does.
3. `Topbar` links to `/line`, `/sight`, `/crypt` and `/settings`. Only the last
   of those still exists.

The API routes these screens called are untouched in `artifacts/api-server` —
including the Groq-key-gated article summaries that only Sight ever displayed.
