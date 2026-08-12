import { Paperclip } from 'lucide-react';

/**
 * The chat surface, mid-thought — Vera has been asked something and is working.
 *
 * A stand-in rather than the real component for the same reason ShotSidebar is
 * one: the chat lives inside Venus.tsx's 2,400-line page, welded to Clerk, chat
 * sessions and a live mutation. Every class name, CSS variable and dimension
 * below is lifted from that file (the bubbles at ~line 1147, the pending
 * indicator at ~1240, VeraAvatar at ~1325), so the photograph is of the real
 * design system.
 *
 * `dots` is the whole trick. The real indicator is three spans on a CSS bounce
 * with staggered delays, and a screenshot of a CSS animation freezes at one
 * arbitrary phase — you would get a still of three dots, not a sense of
 * something thinking. Capturing the same page three times with the phase
 * pinned gives the ad three real frames to cycle, so the loading state in the
 * film is the product's loading state actually animating.
 */

const PHASES = [
  [-4, 0, 0],
  [0, -4, 0],
  [0, 0, -4],
];

function VeraAvatar() {
  return (
    <div
      className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center"
      style={{ background: 'var(--v7-bg-raised-2)', border: '1px solid var(--v7-border-strong)' }}
    >
      <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3">
        <circle cx="12" cy="12" r="9.5" stroke="#3a3d47" strokeWidth="1" />
        <g transform="rotate(-16 12 12)">
          <path d="M12 4.5L13.6 12H10.4L12 4.5Z" fill="#00e5b0" />
          <path d="M12 19.5L11.1 12H12.9L12 19.5Z" fill="#5b4fe8" />
        </g>
        <circle cx="12" cy="12" r="1.3" fill="var(--v7-bg-raised-2)" stroke="#3a3d47" strokeWidth="0.6" />
      </svg>
    </div>
  );
}

export function ShotChat({ prompt, dots }: { prompt: string; dots: number }) {
  const lift = PHASES[dots % PHASES.length]!;

  return (
    <div
      className="flex-1 flex flex-col"
      style={{ background: 'var(--v7-bg)', color: 'var(--v7-text)', minHeight: '100%' }}
    >
      <div className="flex-1 overflow-hidden px-6 py-10">
        <div className="max-w-xl mx-auto space-y-5" data-shot-region="chat:thread">
          <div className="flex justify-end">
            <div data-shot-region="chat:prompt" className="max-w-[70%] bg-[var(--v7-tint)] border border-[var(--v7-tint-border)] rounded-2xl rounded-tr-none px-5 py-3.5 text-sm leading-relaxed">
              {prompt}
            </div>
          </div>

          <div className="flex justify-start">
            <div data-shot-region="chat:thinking" className="flex items-center gap-3">
              <VeraAvatar />
              <div className="flex gap-1">
                {lift.map((dy, i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background: 'var(--v7-cyan)',
                      transform: `translateY(${dy}px)`,
                      opacity: dy < 0 ? 1 : 0.55,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 shrink-0" style={{ borderTop: '1px solid var(--v7-border)' }}>
        <div
          className="max-w-4xl mx-auto flex items-center gap-3"
          style={{
            background: 'var(--v7-bg-raised)',
            border: '1px solid var(--v7-border-strong)',
            borderRadius: '16px',
            padding: '13px 16px',
          }}
        >
          <Paperclip className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--v7-text-mute)' }} />
          <span className="flex-1 text-sm" style={{ color: 'var(--v7-text-mute)' }}>
            Ask Vera anything about your business…
          </span>
        </div>
      </div>
    </div>
  );
}
