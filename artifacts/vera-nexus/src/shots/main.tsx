// Screenshot harness — dev-only entry point, reached at /shots.html.
//
// Mounts the REAL <CommandCenterSection/> (and a faithful stand-in for the
// real sidebar) with a pre-filled react-query cache, so the whole Vera board
// renders with no Clerk session, no api-server and no network. Its only
// consumer is scripts/video-ad-remotion/shots/capture.mjs, which drives a
// headless Chrome over these URLs and writes assets/screenshots/*.png.
//
// index.html does not reference this file, and `vite build` only has
// index.html as an input, so none of this ships.
//
// URL parameters
//   ?shot=<name>     which framing (see SHOTS below) — default `app`
//   ?skin=           deep | midnight | nordic            — default deep
//   ?theme=          dark | light                      — default dark
//   ?state=          pending | resolved                — default pending
//   ?layer=          sidebar | main | rail             — isolate one depth
//   ?mode=           shell | board                     — with or without chrome
//
// When the tree has painted and webfonts have settled, `data-shot-ready="1"`
// lands on <html>. The capture script waits on that rather than a sleep.

import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router as WouterRouter } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import '../index.css';
import './shots.css';

import { CommandCenterSection } from '../pages/CommandCenter';
import { GoalsOverview } from '../pages/GoalsOverview';
import { ShotChat } from './ShotChat';
import { setSkin, type VeraSkin } from '../lib/veraSkin';
import { ShotSidebar } from './ShotSidebar';
import {
  QUEUE_PENDING, QUEUE_RESOLVED, DAILY_BRIEF, CONNECTORS, SAVED_ANALYSES, GOALS, CHAT_PROMPT,
} from './fixtures';

const params = new URLSearchParams(window.location.search);
const param = (key: string, fallback: string) => params.get(key) ?? fallback;

const skin = param('skin', 'deep') as VeraSkin;
const theme = param('theme', 'dark') === 'light' ? 'light' : 'dark';
const state = param('state', 'pending');
const layer = params.get('layer');
const mode = param('mode', 'shell');
// Which product surface to photograph. 'board' is the overnight queue, 'goals'
// the real cross-chat goal list, 'chat' the assistant mid-thought.
const surface = param('surface', 'board');
// Phase of the thinking indicator, so three captures can be cycled back into a
// real animation rather than one frozen frame of a CSS bounce.
const dots = Number(param('dots', '0')) || 0;

// index.css's base layer puts an opaque `bg-background` on <body>, which sits
// above anything the harness root can override — a layer capture would come
// back as a solid rectangle. The alpha has to be punched in on the two
// elements React never owns.
if (layer) document.documentElement.classList.add('shots-transparent-page');

const items = state === 'resolved' ? QUEUE_RESOLVED : QUEUE_PENDING;
const pendingCount = items.filter((i) => i.status === 'pending').length;

// The "Kept" tile reads localStorage directly rather than the API, so it has
// to be seeded before the component mounts.
try {
  localStorage.setItem('ve_saved_analyses', JSON.stringify(SAVED_ANALYSES));
} catch {
  // Nothing to do — the tile just renders its empty state.
}

// setSkin, not applySkin: applySkin only stamps the attribute on <html>, which
// styles the page but leaves veraSkin's module state on its stored default —
// so every component asking useVeraSkin() would still render against its
// branch under a different palette. This is the one call that moves both.
setSkin(skin);
// Every identity is a real design now (classic, which was the absence of
// one, is gone), so this is constant true. Kept as a named flag because many
// style branches read it; collapsing those is a separate change.
const skinned = true;

// Seeding the cache rather than stubbing the hooks: the components keep using
// the real useQueue/useDailyBrief/useConnectors, so nothing about the render
// path is special-cased for screenshots.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
});
queryClient.setQueryData(['/api/queue'], { items });
queryClient.setQueryData(['/api/daily-brief'], DAILY_BRIEF);
queryClient.setQueryData(['/api/connectors'], { connectors: CONNECTORS });
queryClient.setQueryData(['/api/goals'], { goals: GOALS });

function ReadyFlag() {
  useEffect(() => {
    let cancelled = false;
    const settle = async () => {
      try {
        // Bounded: if the webfont request is slow or blocked, the capture
        // should proceed with fallback faces rather than hang the whole run.
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
      } catch {
        // Older engines without the Font Loading API just fall through.
      }
      // A timer rather than requestAnimationFrame: rAF does not fire in a
      // tab that isn't compositing, which is exactly the state a headless
      // capture can be in, and the flag would never land. 120ms is enough
      // for the reflow the webfonts cause to settle.
      setTimeout(() => {
        if (!cancelled) document.documentElement.setAttribute('data-shot-ready', '1');
      }, 120);
    };
    void settle();
    return () => { cancelled = true; };
  }, []);
  return null;
}

const rootClasses = [
  'shots-root',
  `shots-mode-${mode}`,
  layer ? `shots-layer-${layer}` : '',
  layer ? 'shots-transparent' : '',
  theme === 'light' ? 'v7-light' : '',
].filter(Boolean).join(' ');

function Harness() {
  return (
    <div
      className={rootClasses}
      style={{
        display: 'flex',
        width: '100%',
        background: 'var(--v7-bg)',
        color: 'var(--v7-text)',
        fontFamily: 'var(--v7-font-round)',
      }}
    >
      {mode === 'shell' && <ShotSidebar skinned={skinned} pendingCount={pendingCount} />}
      <div className="shots-board" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {surface === 'goals' ? (
          <GoalsOverview />
        ) : surface === 'chat' ? (
          <ShotChat prompt={CHAT_PROMPT} dots={dots} />
        ) : (
          <CommandCenterSection theme={theme} onBack={() => {}} />
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* memoryLocation keeps wouter's useLocation happy without touching
          the address bar, which the capture script keys off. */}
      <WouterRouter hook={memoryLocation({ path: '/vera' }).hook}>
        <ReadyFlag />
        <Harness />
      </WouterRouter>
    </QueryClientProvider>
  </StrictMode>,
);
