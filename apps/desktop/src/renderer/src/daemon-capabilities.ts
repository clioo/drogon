/* MIT Copyright (c) 2026 Lovecast Inc.
   User-feature-closure item 7: a mixed-version data dir (an old `drogond`
   still holding the endpoint lock while a newer packaged desktop attaches
   to it, per `native-runtime-bootstrap.ts`'s "attach to already-healthy,
   never spawn over it" contract) answers `daemon.status` successfully —
   `bootstrapNativeRuntime` correctly returns "already-healthy" for that,
   and must keep doing so: this module is deliberately NOT a spawn/restart
   decision. `Status.ok === true` only proves the socket answers *a*
   protocol-1 daemon, not that it advertises every capability this build's
   UI assumes. `bot.snapshot.v1` (see bots-mount.ts's BOTS_CAPABILITY) is
   already fail-closed gated end-to-end (isBotsAvailable +
   createGatedBotBridge). `agent.settings.v1` (crates/drogon-core/src/lib.rs's
   CAPABILITIES) had no such gate anywhere in the desktop before this file —
   an old daemon lacking it would answer the Agent Settings RPCs with an
   opaque "unknown method" instead of a clear, attributable notice. This
   module is pure and side-effect free: callers decide how to surface the
   gap (a notice, a disabled control) and never restart or kill anything on
   its own — that stays a manual `drogon:daemon:restart` action. */
import { BOTS_CAPABILITY } from "./bots-mount";

/** The capability an old daemon predating Agent Settings support never
 *  advertises (crates/drogon-core/src/lib.rs's CAPABILITIES list). */
export const AGENT_SETTINGS_CAPABILITY = "agent.settings.v1";

/** True exactly when the live service advertises agent.settings.v1. */
export function isAgentSettingsAvailable(
  capabilities: readonly string[],
): boolean {
  return capabilities.includes(AGENT_SETTINGS_CAPABILITY);
}

/** The capabilities a mixed-version guard checks for explicitly (task item
 *  7's own wording: "missing agent.settings/Bots capabilities"). Not every
 *  capability in CAPABILITIES -- only the two the UI has historically
 *  assumed present without checking. */
export const REQUIRED_DAEMON_CAPABILITIES: readonly string[] = [
  AGENT_SETTINGS_CAPABILITY,
  BOTS_CAPABILITY,
];

/** Every required capability the live service does NOT advertise, in
 *  `REQUIRED_DAEMON_CAPABILITIES` order. Empty means the attached daemon is
 *  capability-complete for this build's assumptions. */
export function missingRequiredCapabilities(
  capabilities: readonly string[],
): string[] {
  return REQUIRED_DAEMON_CAPABILITIES.filter(
    (capability) => !capabilities.includes(capability),
  );
}

/** True when the attached service is missing a capability this build
 *  assumes -- the "already-healthy, but mixed-version" case: the socket
 *  answered, so bootstrap correctly attached (never re-spawns, never kills
 *  the incumbent), but the UI must not silently claim full functionality. */
export function isMixedVersionDaemon(capabilities: readonly string[]): boolean {
  return missingRequiredCapabilities(capabilities).length > 0;
}
