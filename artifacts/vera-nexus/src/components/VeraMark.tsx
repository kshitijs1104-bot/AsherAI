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
   cannot be re-cut cheaply.

   COLOUR — SECOND PASS. The mark used to be drawn in a literal teal-to-violet
   gradient with two differently coloured terminal dots, on the reasoning that
   fixed brand hues make it one mark rather than two. In practice that read as
   two clashing colours stuck to a letterform, and it belonged to neither the
   palette around it nor any of the three identities.

   It is now monochrome and takes the active accent (`--v7-cyan`, which is the
   app's "this is interactive" slot and is redefined by every identity). One
   mark, one colour, and it is always in the same family as the surface it sits
   on. The single terminal dot is what keeps it from reading as a bare glyph —
   it marks where the stroke resolves, which is the one detail the original had
   worth keeping.

   `currentColor` is the fallback so a caller can still force a colour by
   setting `color` on the element (the landing page's footer does this).
--------------------------------------------------------------------------- */

export function VeraMark({ size = 20, className, style }: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
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
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="var(--vera-mark-ring, currentColor)"
        strokeOpacity="0.28"
      />
      <path
        d="M6.5 8.5 L12 17 L17.5 8.5"
        stroke="var(--vera-mark-ink, var(--v7-cyan, currentColor))"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* One terminal, not two. It marks where the stroke resolves and gives
          the mark an asymmetry to be recognised by; a dot on each arm just
          read as decoration. */}
      <circle cx="17.5" cy="8.5" r="1.7" fill="var(--vera-mark-ink, var(--v7-cyan, currentColor))" />
    </svg>
  );
}
