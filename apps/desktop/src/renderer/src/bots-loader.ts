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
  if (
    scope.hostId.length === 0 ||
    scope.workspaceId.length === 0 ||
    scope.locale.length === 0
  ) {
    return {
      scope,
      status: "error",
      code: "invalid_scope",
      message: "hostId, workspaceId and locale must be non-empty",
      retryable: false,
    };
  }
  const response = await bridge.botSnapshot(scope);
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
  const { bots, history } = parsed.data;
  return {
    scope,
    status: "loaded",
    snapshot: { bots, history },
    observedLiveness: {},
  };
}
