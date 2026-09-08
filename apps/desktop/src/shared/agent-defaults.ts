/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/shared/tui-agent-permissions.ts (YOLO_TUI_AGENT_ARGS: the default
   launch args per agent — `--dangerously-skip-permissions` for Claude Code
   and Antigravity, none for Pi/OpenCode) and
   src/shared/tui-agent-launch-defaults.ts (DEFAULT_TUI_AGENT_ARGS, resolved
   when the user configured nothing). Adapter: Drogon's four harnesses with
   this repo's `inherit`/`unattended` permission vocabulary; `unattended`
   maps to the daemon adapter flags in crates/drogon-harness (plan_launch):
   Claude/Antigravity `--dangerously-skip-permissions`, Pi `--approve`,
   OpenCode `--auto`. A menu-row click launches immediately with these
   resolved values — there is no per-launch dialog, exactly like the fork's
   `launchAgentFromNewTabEntry`. */
import type {
  HarnessId,
  HarnessLaunchInput,
  PermissionMode,
} from "./session-contract";

/**
 * Fork-default permission mode per harness: a fresh Orca launches Claude
 * Code (and Antigravity) with its yolo args and Pi/OpenCode bare. A stored
 * per-harness entry always wins over these.
 */
export const DEFAULT_HARNESS_PERMISSION_MODES: Record<
  HarnessId,
  PermissionMode
> = {
  claude: "unattended",
  antigravity: "unattended",
  pi: "inherit",
  opencode: "inherit",
};

/** Stored per-harness launch defaults (structural: mirrors the renderer settings shape). */
export type HarnessAgentDefaultFields = {
  model: string;
  effort: string;
  permissionMode: PermissionMode;
};

export const EMPTY_HARNESS_AGENT_DEFAULT_FIELDS: HarnessAgentDefaultFields = {
  model: "",
  effort: "",
  permissionMode: "inherit",
};

/** Stored entry wins; an absent key falls back to the fork defaults above. */
export function resolveHarnessAgentDefault(
  harnessId: HarnessId,
  defaults: Record<string, HarnessAgentDefaultFields>,
): HarnessAgentDefaultFields {
  return (
    defaults[harnessId] ?? {
      ...EMPTY_HARNESS_AGENT_DEFAULT_FIELDS,
      permissionMode: DEFAULT_HARNESS_PERMISSION_MODES[harnessId],
    }
  );
}

/** The stored-or-fork permission mode driving every launch path. */
export function resolveHarnessPermissionMode(
  harnessId: HarnessId,
  defaults: Record<string, HarnessAgentDefaultFields>,
): PermissionMode {
  return resolveHarnessAgentDefault(harnessId, defaults).permissionMode;
}

function optionalField(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Splits a Pi `provider/model-id` shorthand (the Settings Model field and
 * the bot `explicitModel` shape) into the separate `--provider`/`--model`
 * flags this Pi build requires — it rejects the combined pattern with
 * `Model "p/m" not found` (acceptance, R16-AO). A bare id without a slash
 * rides as `--model` alone, which Pi also accepts.
 */
export function splitPiProviderModel(model: string): {
  provider?: string;
  model?: string;
} {
  const trimmed = model.trim();
  if (trimmed === "") return {};
  const slash = trimmed.indexOf("/");
  if (slash > 0 && slash < trimmed.length - 1) {
    return {
      provider: trimmed.slice(0, slash),
      model: trimmed.slice(slash + 1),
    };
  }
  return { model: trimmed };
}

/**
 * Builds the `harness.start` input for an immediate menu-row launch: the
 * stored (or fork-default) model/effort/permission mode, blank fields sent
 * as absent keys. A Pi `provider/model-id` shorthand splits into the
 * separate flags Pi requires; every other harness takes the model verbatim.
 */
export function buildImmediateHarnessLaunch(
  workspaceId: string,
  harnessId: HarnessId,
  defaults: Record<string, HarnessAgentDefaultFields>,
): Omit<HarnessLaunchInput, "requestId"> {
  const resolved = resolveHarnessAgentDefault(harnessId, defaults);
  const split =
    harnessId === "pi" ? splitPiProviderModel(resolved.model) : null;
  return {
    workspaceId,
    harnessId,
    model: split ? split.model : optionalField(resolved.model),
    provider: split?.provider,
    effort: optionalField(resolved.effort),
    prompt: undefined,
    permissionMode: resolved.permissionMode,
  };
}
