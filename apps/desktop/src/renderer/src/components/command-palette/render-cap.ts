/* MIT Copyright (c) 2026 Lovecast Inc.
 * Ported from the read-only reference
 * the read-only Orca reference `src/renderer/src/components/cmd-j/palette-section-render-cap.ts`
 * (Orca 1.4.197 + Drogon fork). Adapted: standalone module, only the
 * hard-cap slice this palette needs (no multi-primary interleave).
 */

/**
 * Typed queries used to render every match as a DOM row — a one-character query
 * against a few hundred files built hundreds of items (each with highlight
 * spans) on every keystroke. Capping the rendered slice bounds worst-case DOM
 * without changing ranking: the top matches are already the ones the user
 * wants, and the overflow hint points at the way to reach the rest.
 */
export const PALETTE_SECTION_RENDER_CAP = 50;

export type CappedPaletteSection<T> = {
  visible: readonly T[];
  overflowCount: number;
};

export function capPaletteSection<T>(
  items: readonly T[],
  cap: number = PALETTE_SECTION_RENDER_CAP,
): CappedPaletteSection<T> {
  if (!Number.isFinite(cap) || cap < 0 || items.length <= cap) {
    return { visible: items, overflowCount: 0 };
  }
  return { visible: items.slice(0, cap), overflowCount: items.length - cap };
}
