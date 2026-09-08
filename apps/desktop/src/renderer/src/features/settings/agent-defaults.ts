// Per-harness launch-default resolution for the Agents section and every
// immediate launch path. Empty model/effort means "no preference" (sent as
// absent); unattended maps to the harness bridge's `unattended` permission
// mode. An absent stored entry falls back to the fork defaults shared with
// the menu (yolo/unattended for Claude Code and Antigravity, prompts kept
// for Pi and OpenCode) — see shared/agent-defaults.ts.
import type { HarnessId } from "../../../../shared/session-contract";
import {
  resolveHarnessAgentDefault,
  type HarnessAgentDefaultFields,
} from "../../../../shared/agent-defaults";
import type {
  HarnessAgentDefault,
  HarnessPermissionMode,
} from "../../settings-store";

export type LaunchDefaultValues = {
  model: string;
  effort: string;
  unattended: boolean;
};

export function resolveLaunchDefaults(
  harnessId: string,
  defaults: Record<string, HarnessAgentDefault>,
): LaunchDefaultValues {
  // HarnessAgentDefault is structurally identical to the shared fields, so
  // the stored entry passes straight through; only the key needs the
  // harness-id narrow for the fork-default fallback.
  const entry: HarnessAgentDefaultFields = resolveHarnessAgentDefault(
    harnessId as HarnessId,
    defaults,
  );
  return {
    model: entry.model,
    effort: entry.effort,
    unattended: entry.permissionMode === "unattended",
  };
}

export function buildHarnessAgentDefault(
  values: LaunchDefaultValues,
): HarnessAgentDefault {
  const permissionMode: HarnessPermissionMode = values.unattended
    ? "unattended"
    : "inherit";
  return { model: values.model, effort: values.effort, permissionMode };
}

/**
 * Field validation mirroring the harness bridge (bridge-validation.ts
 * opaque fields): free text up to the wire limit, never control characters.
 * Returns the error message, or null when the value may be saved.
 */
export function validateAgentDefaultField(
  field: "model" | "effort",
  value: string,
): string | null {
  const max = field === "model" ? 4096 : 256;
  if (value.length > max)
    return `Keep ${field} under ${max} characters.`;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value))
    return `${field === "model" ? "Model" : "Effort"} cannot contain control characters.`;
  return null;
}


