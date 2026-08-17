import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { ArrowRight, X } from 'lucide-react';
import { useNudges, useMarkNudgesShown, useDismissNudge, type Nudge } from '../lib/venusApi';

/* ---------------------------------------------------------------------------
   The open loops, at the top of the board.

   Every card here names something REAL and UNFINISHED for this founder — an
   unanswered dossier question, a thread they walked away from, a streak that
   ends tonight. The server derives them per request from actual state
   (api-server lib/nudges.ts); nothing is stored, so nothing can go stale and
   still be shown.

   WHY THIS SITS ABOVE THE QUEUE. The board's own items are things VERA did and
   is waiting on a decision for. These are things the FOUNDER started and did
   not finish. The second kind is the one that pulls someone back into a
   product, and burying it under a list of drafted emails is how it gets missed.

   TWO RULES THIS COMPONENT ENFORCES, both about not becoming noise:

     It reports "shown" only after a real render (the effect below), never on
     fetch. A background poll marking them shown would burn the three-hour
     cooldown and the six-show ceiling on nudges no human ever saw.

     Every card can be dismissed, permanently. A prompt you cannot turn off is
     an advert. The dismissal is per KIND, so saying no to "set a goal" never
     silences "you left a question hanging".

   Renders nothing at all when there is nothing genuinely outstanding — an
   empty state here would be a box congratulating the founder for having no
   unfinished work, which is exactly the kind of filler this product avoids.
--------------------------------------------------------------------------- */

const PRIORITY_ACCENT: Record<Nudge['priority'], string> = {
  high: 'var(--v7-amber, #e0a868)',
  normal: 'var(--v7-cyan)',
  low: 'var(--v7-border-strong)',
};

export function NudgeStrip({ onNavigate }: { onNavigate?: (href: string) => void }) {
  const { data } = useNudges();
  const markShown = useMarkNudgesShown();
  const dismiss = useDismissNudge();
  const [, navigate] = useLocation();

  const nudges = data?.nudges ?? [];

  // Report exactly once per distinct set. The ref guards against the effect
  // re-firing on unrelated re-renders (a sibling query resolving, a theme
  // toggle) and spending a founder's show-budget for no new information.
  const reportedRef = useRef<string>('');
  useEffect(() => {
    if (nudges.length === 0) return;
    const signature = nudges.map((n) => n.kind).sort().join(',');
    if (reportedRef.current === signature) return;
    reportedRef.current = signature;
    markShown.mutate(nudges.map((n) => n.kind));
    // markShown is a stable mutation object from TanStack; including it would
    // re-run this on every render for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nudges]);

  if (nudges.length === 0) return null;

  const go = (href: string) => {
    // The board lives inside Venus.tsx's view state, not a route of its own, so
    // an in-app link to it has to be handled by the parent rather than pushed
    // at the router — otherwise "Open the board" would navigate to a URL that
    // renders the chat.
    if (href.includes('view=command-center') && onNavigate) {
      onNavigate(href);
      return;
    }
    navigate(href);
  };

  return (
    <section aria-label="Unfinished" style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
      {nudges.map((n) => (
        <div
          key={n.kind}
          className="flex items-start gap-3 rounded-xl px-3.5 py-3"
          style={{
            background: 'var(--v7-bg-raised)',
            border: '1px solid var(--v7-border)',
            borderLeft: `2px solid ${PRIORITY_ACCENT[n.priority]}`,
          }}
        >
          <div className="min-w-0 flex-1">
            <div
              className="font-semibold"
              style={{ fontSize: 13, color: 'var(--v7-text)', lineHeight: 1.35 }}
            >
              {n.title}
            </div>
            <div style={{ fontSize: 12, color: 'var(--v7-text-mute)', lineHeight: 1.5, marginTop: 2 }}>
              {n.body}
            </div>
            <button
              type="button"
              onClick={() => go(n.href)}
              className="inline-flex items-center gap-1.5 mt-2 font-semibold transition-opacity hover:opacity-80"
              style={{ fontSize: 12, color: PRIORITY_ACCENT[n.priority], background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              {n.actionLabel}
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => dismiss.mutate(n.kind)}
            title="Don't show this again"
            aria-label={`Dismiss: ${n.title}`}
            className="shrink-0 p-1 rounded-md transition-colors"
            style={{ color: 'var(--v7-text-mute)' }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </section>
  );
}
