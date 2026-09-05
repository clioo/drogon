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
