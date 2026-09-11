/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/shared/drogon-product-mode.ts surface-visibility gate (adapter: local
   shell copy because shared/ is coordinator-owned). Meetings is visible as
   of the meetings surface landing (the row was already ported, dark); Mobile
   exists in the source but stays out of the MVP, hidden behind this gate. */

export type DrogonProductSurface = "sessions" | "bots" | "meetings" | "mobile";

export const DROGON_PRODUCT_SURFACE_VISIBILITY: Readonly<
  Record<DrogonProductSurface, boolean>
> = {
  sessions: true,
  bots: true,
  // The owner's own Write That Down notes are a real surface now: the row
  // routes to the Meetings page and reports honest states instead of
  // pretending the folder is empty.
  meetings: true,
  mobile: false,
};

export function isDrogonProductSurfaceVisible(
  surface: DrogonProductSurface,
): boolean {
  return DROGON_PRODUCT_SURFACE_VISIBILITY[surface];
}
