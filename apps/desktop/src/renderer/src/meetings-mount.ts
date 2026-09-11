// Mount adapter for the Meetings surface (the owner's own Write That Down
// notes). Mirrors tasks-mount.ts / bots-mount.ts: registers nothing on
// import, mints the branded route id here, and wraps the granted bridge in a
// fail-closed capability gate so a service without meetings.v1 refuses
// locally instead of rendering an empty, misleading list.
//
// App mounts the page directly inside its keep-alive section host (the same
// shape the Tasks page uses when no descriptor scope is available), so this
// module owns the route id, the capability gate and the bridge lookup and
// nothing else.
import {
  MEETINGS_ACTIONS_CAPABILITY,
  MEETINGS_CAPABILITY,
  type MeetingsBridge,
} from "../../shared/meetings-contract";
import { routeId } from "./route-panel-contract";

/** Branded form of the "meetings" route id SidebarNav already routes to. */
export const MEETINGS_ROUTE_ID = routeId("meetings");

export { MEETINGS_ACTIONS_CAPABILITY, MEETINGS_CAPABILITY };

/** The keep-alive host section's test id (App.tsx and the Escape hook share it). */
export const MEETINGS_PAGE_HOST_TESTID = "meetings-page-host";

/** True exactly when the live service advertises meetings.v1. */
export function isMeetingsAvailable(capabilities: readonly string[]): boolean {
  return capabilities.includes(MEETINGS_CAPABILITY);
}

/**
 * True when the service also advertises the working half (extraction and the
 * commitment ledger). Index-only services are still usable; the page simply
 * does not offer the actions.
 */
export function isMeetingsActionsAvailable(capabilities: readonly string[]): boolean {
  return capabilities.includes(MEETINGS_ACTIONS_CAPABILITY);
}

/**
 * The granted `window.drogon.meetings` namespace. DesktopBridge declares it
 * optionally (a build without the meetings bridge has no namespace at all),
 * so the page renders the honest "no bridge" failure rather than guessing.
 */
export function windowMeetingsBridge(): MeetingsBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { drogon?: { meetings?: MeetingsBridge } }).drogon;
  return bridge?.meetings ?? null;
}

/**
 * Fail-closed capability gate: every call evaluates its predicate at call
 * time, so a mid-life loss refuses on the very next call and the page never
 * shows stale or invented meetings.
 *
 * Two predicates, not one: listing and reading the notes is `meetings.v1`,
 * while extracting and recording actions is `meetings.actions.v1`. An
 * index-only service therefore stays fully usable — the page browses and
 * searches, and the actions refuse with their own capability message instead
 * of a shape that cannot work.
 */
export function createGatedMeetingsBridge(
  source: MeetingsBridge,
  isAllowed: () => boolean,
  isActionsAllowed: () => boolean = isAllowed,
): MeetingsBridge {
  const refused = () =>
    Promise.resolve({
      ok: false as const,
      error: {
        code: "unsupported_capability",
        message: "meetings.v1 capability is not advertised by the service",
        retryable: true,
      },
    });
  const actionsRefused = () =>
    Promise.resolve({
      ok: false as const,
      error: {
        code: "unsupported_capability",
        message:
          "meetings.actions.v1 capability is not advertised by the service",
        retryable: true,
      },
    });
  return {
    list: (input) => (isAllowed() ? source.list(input) : refused()),
    read: (input) => (isAllowed() ? source.read(input) : refused()),
    analyze: (input) => (isActionsAllowed() ? source.analyze(input) : actionsRefused()),
    commitments: (input) =>
      isActionsAllowed() ? source.commitments(input) : actionsRefused(),
    accept: (input) => (isActionsAllowed() ? source.accept(input) : actionsRefused()),
    resolve: (input) => (isActionsAllowed() ? source.resolve(input) : actionsRefused()),
  };
}
