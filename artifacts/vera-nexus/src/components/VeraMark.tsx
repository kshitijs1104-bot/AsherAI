import { useId } from 'react';

/* ---------------------------------------------------------------------------
   The Vera mark — one definition, every surface.

   THE PROBLEM THIS CLOSES. There were two unrelated logos in the product. The
   landing page and the launch film used a V inside a ring with a teal and a
   violet terminal; the chat's hero used a compass needle. Nothing shared a
   line between them, so the page that sells Vera and the page that IS Vera
   were branded as different products, and a founder arriving from the film
   met a mark they had never seen.

   The V is the one that survives, for the plain reason that it is already
   published: it is in the landing page and baked into a rendered film that
   cannot be re-cut cheaply. Picking the compass would have meant reshooting
   the ad to match an internal screen, which is the tail wagging the dog.

   COLOUR. The two terminals keep their literal brand hues in both themes —
   they are the mark's identity, and a logo that changes colour with the
   theme is not one mark but two. Only the ring is themed, because at 22%
   white it is invisible on a light page; it reads as the same weight of
   "quiet enclosing circle" against either background.
--------------------------------------------------------------------------- */

const TEAL = '#2fdcc0';
const VIOLET = '#8b7bff';

export function VeraMark({ size = 20, className, style }: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  // Two marks on one page (nav and footer, hero and sidebar) would otherwise
  // both define `#lp-mark` and the second would silently win for both — the
  // classic duplicated-SVG-gradient-id bug, which shows up as one mark
  // rendering with the other's fill.
  const gradientId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="var(--vera-mark-ring, rgba(255,255,255,0.22))" />
      <path
        d="M6.5 8.5 L12 17 L17.5 8.5"
        stroke={`url(#${gradientId})`}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6.5" cy="8.5" r="1.9" fill={TEAL} />
      <circle cx="17.5" cy="8.5" r="1.9" fill={VIOLET} />
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor={TEAL} />
          <stop offset="100%" stopColor={VIOLET} />
        </linearGradient>
      </defs>
    </svg>
  );
}
