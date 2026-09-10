// Stateful-snapshot loader for the Bots mount. bot.snapshot.v1 stays DARK:
// this module only loads and validates a snapshot, never runs anything and
// offers no run-control surface. Retry is always a fresh call - nothing is
// cached and no previous result is reused. The loader itself observes no
// liveness: a stored session is a link, not proof of a live process, so the
// loaded result carries an empty observedLiveness record for callers to
// merge real observations into.

import type { Result } from "../../shared/session-contract";
import type {
  BotSnapshotInput,
  BotsPanelHostObservation,
  BotsPanelSnapshot,
} from "../../shared/bot-contract";
import { botSnapshotResultSchema } from "../../shared/bot-validation";

export type BotsLoadScope = BotSnapshotInput;

/** App-global Bots scope (#348/R17-E): the Bots page always lists
 *  app-globally like the fork's `window.api.bots.list()` — never narrowed
 *  to the selected workspace's folder (which rendered 'No Bots yet' for
 *  bots owned elsewhere). Takes no workspace id by construction, so the
 *  scope cannot narrow. Null while the service status (hostId) is unknown. */
export function resolveBotsScope(
  status: { hostId: string } | null,
  locale: string,
): BotsLoadScope | null {
  if (!status) return null;
  return { hostId: status.hostId, workspaceId: "", locale };
}

/** Minimal structural bridge: exactly the one method the loader needs. */
export type BotsSnapshotBridge = {
  botSnapshot(
    input: BotSnapshotInput,
  ): Promise<Result<BotsPanelSnapshot & { hostId: string; workspaceId: string }>>;
};

export type BotsLoadResult =
  | {
      scope: BotsLoadScope;
      status: "loaded";
      snapshot: BotsPanelSnapshot;
      observedLiveness: Record<string, BotsPanelHostObservation>;
    }
  | {
      scope: BotsLoadScope;
      status: "error";
      code: string;
      message: string;
      retryable: boolean;
    }
  | { scope: BotsLoadScope; status: "too_large"; message: string };

/**
 * Loads one snapshot for the exact scope triple. Source snapshot_too_large
 * errors map to a distinct too_large result (never folded into generic
 * errors); an ok payload that fails the shared validator maps to an
 * invalid_snapshot error (never an empty success); every other source error
 * passes through verbatim.
 */
export async function loadBotSnapshot(
  bridge: BotsSnapshotBridge,
  scope: BotsLoadScope,
): Promise<BotsLoadResult> {
  if (scope.hostId.length === 0 || scope.locale.length === 0) {
    return {
      scope,
      status: "error",
      code: "invalid_scope",
      message: "hostId and locale must be non-empty",
      retryable: false,
    };
  }
  // workspaceId "" is the app-global scope (#348, fixes the zero-workspace
  // Bots page): the fork's controller lists bots app-globally via
  // window.api.bots.list(), so an empty workspace scope asks the daemon for
  // the host-wide snapshot. Non-empty scopes stay exact-workspace reads.
  const invalidScope = (message: string): BotsLoadResult => ({
    scope,
    status: "error",
    code: "scope_mismatch",
    message,
    retryable: false,
  });
  let response: Awaited<ReturnType<BotsSnapshotBridge["botSnapshot"]>>;
  try {
    response = await bridge.botSnapshot(scope);
  } catch (error) {
    // Transport/preload throws (not Result errors): explicit error with
    // retry, never an unhandled rejection or a forever-loading UI.
    return {
      scope,
      status: "error",
      code: "snapshot_transport",
      message:
        error instanceof Error ? error.message : "botSnapshot threw",
      retryable: true,
    };
  }
  if (!response.ok) {
    if (response.error.code === "snapshot_too_large") {
      return { scope, status: "too_large", message: response.error.message };
    }
    return {
      scope,
      status: "error",
      code: response.error.code,
      message: response.error.message,
      retryable: response.error.retryable,
    };
  }
  const parsed = botSnapshotResultSchema.safeParse(response.result);
  if (!parsed.success) {
    return {
      scope,
      status: "error",
      code: "invalid_snapshot",
      message: parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
      retryable: false,
    };
  }
  // The bridge guards scope today, but the loader contract is exact:
  // a response for another host/workspace is rejected, never shown.
  if (
    parsed.data.hostId !== scope.hostId ||
    parsed.data.workspaceId !== scope.workspaceId
  ) {
    return invalidScope(
      `snapshot scope ${parsed.data.hostId}/${parsed.data.workspaceId} ` +
        `does not match requested ${scope.hostId}/${scope.workspaceId}`,
    );
  }
  const { bots, history } = parsed.data;
  return {
    scope,
    status: "loaded",
    snapshot: { bots, history },
    observedLiveness: {},
  };
}
