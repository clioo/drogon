/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/shared/drogon-product-mode.ts surface-visibility gate (adapter: local
   shell copy because shared/ is coordinator-owned). Meetings and Mobile
   exist in the source but are out of the MVP: their rows stay in the nav
   code behind this gate, hidden until the surfaces land. */

export type DrogonProductSurface = "sessions" | "bots" | "meetings" | "mobile";

export const DROGON_PRODUCT_SURFACE_VISIBILITY: Readonly<
  Record<DrogonProductSurface, boolean>
> = {
  sessions: true,
  bots: true,
  meetings: false,
  mobile: false,
};

export function isDrogonProductSurfaceVisible(
  surface: DrogonProductSurface,
): boolean {
  return DROGON_PRODUCT_SURFACE_VISIBILITY[surface];
}
