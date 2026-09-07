// Mount adapter for the Changes panel (features/source-control,
// journey J2). Binds the real factory through the route-panel-contract
// boundary, mirroring files-mount.ts. Registers nothing on import.

import { GIT_CAPABILITY, type GitBridge } from "../../shared/git-contract";
import {
  createChangesPanelDescriptor,
  CHANGES_ROUTE_ID as FEATURE_CHANGES_ROUTE_ID,
  isChangesAvailable,
} from "./features/source-control";
import { registerRoute, routeId } from "./route-panel-contract";
import type { PanelDescriptor, RouteRegistry } from "./route-panel-contract";

/** Branded form of the feature route id; empty ids throw at import. */
export const CHANGES_ROUTE_ID = routeId(FEATURE_CHANGES_ROUTE_ID);

export { GIT_CAPABILITY, isChangesAvailable };

/**
 * The granted `window.drogon.git.*` namespace. DesktopBridge (coordinator-
 * owned) does not declare it yet, so the cast lives here — one place —
 * rather than at every call site. Follow-up for the coordinator: declare
 * `git: GitBridge` on DesktopBridge and delete this helper.
 */
export function windowGitBridge(): GitBridge {
  return (window.drogon as unknown as { git: GitBridge }).git;
}

/**
 * Fail-closed capability gate around a GitBridge. Every call evaluates
 * isAllowed at call time: when the live service withholds git.v1 the call
 * is refused locally (never reaching the service) with an explicit
 * retryable error.
 */
export function createGatedGitBridge(
  source: GitBridge,
  isAllowed: () => boolean,
): GitBridge {
  const refused = () =>
    Promise.resolve({
      ok: false as const,
      error: {
        code: "unsupported_capability",
        message: "git.v1 capability is not advertised by the service",
        retryable: true,
      },
    });
  return {
    gitStatus: (input) => (isAllowed() ? source.gitStatus(input) : refused()),
    gitDiff: (input) => (isAllowed() ? source.gitDiff(input) : refused()),
    gitStage: (input) => (isAllowed() ? source.gitStage(input) : refused()),
    gitUnstage: (input) => (isAllowed() ? source.gitUnstage(input) : refused()),
    gitCommit: (input) => (isAllowed() ? source.gitCommit(input) : refused()),
    gitPush: (input) => (isAllowed() ? source.gitPush(input) : refused()),
    gitPrCreate: (input) =>
      isAllowed() ? source.gitPrCreate(input) : refused(),
  };
}

/** Registers the real Changes route (capability-gated on git.v1). */
export function registerChangesRoute(
  registry: RouteRegistry,
  bridge: GitBridge,
): RouteRegistry {
  const descriptor = createChangesPanelDescriptor({ bridge });
  const adapted: PanelDescriptor = {
    ...descriptor,
    id: routeId(descriptor.id),
  };
  return registerRoute(registry, adapted);
}
