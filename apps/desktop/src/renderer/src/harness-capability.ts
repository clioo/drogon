import type { Harness } from "../../shared/session-contract";

export const HARNESS_LAUNCH_CAPABILITIES = [
  "harness.catalog.v1",
  "harness.launch.v1",
] as const;

/** Both capabilities must be advertised; an older service missing either one gets `method_not_found` on the underlying RPCs, so the menu must not be offered. */
export function supportsHarnessLaunch(capabilities: string[]): boolean {
  return HARNESS_LAUNCH_CAPABILITIES.every((capability) =>
    capabilities.includes(capability),
  );
}

/**
 * Independent catalog-capability probe for the held catalog-RPC handover:
 * `harness.catalog.v1` is advertised, but `harness.list` still carries
 * binaries only (no per-model enumeration), so nothing today can render
 * a host-confirmed selection — every shape-valid id rides
 * manual-unverified. Pure adapter; the future catalog RPC wires this.
 */
export function supportsHarnessCatalog(capabilities: string[]): boolean {
  return capabilities.includes("harness.catalog.v1");
}

/**
 * Host fencing for launch surfaces: only a harness the service lists as
 * `available` may be offered or recovered. Centralizes the inline
 * `availability !== "available"` checks so future consumers (recovery,
 * composer) share one rule; not yet wired into menus (held composition).
 */
export function isHarnessLaunchable(
  harness: Pick<Harness, "availability">,
): boolean {
  return harness.availability === "available";
}
