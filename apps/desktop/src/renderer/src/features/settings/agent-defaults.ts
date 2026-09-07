// Per-harness launch-default resolution for the Agents section and the "+"
// launch menu. Empty model/effort means "no preference" (sent as absent);
// unattended maps to the harness bridge's `unattended` permission mode.
import type {
  HarnessAgentDefault,
  HarnessPermissionMode,
} from "../../settings-store";
import { EMPTY_HARNESS_AGENT_DEFAULT } from "../../settings-store";

export type LaunchDefaultValues = {
  model: string;
  effort: string;
  unattended: boolean;
};

export function resolveLaunchDefaults(
  harnessId: string,
  defaults: Record<string, HarnessAgentDefault>,
): LaunchDefaultValues {
  const entry = defaults[harnessId] ?? EMPTY_HARNESS_AGENT_DEFAULT;
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

/** True when a launch form still holds its untouched empty values. */
export function isPristineLaunchForm(values: LaunchDefaultValues): boolean {
  return (
    values.model === "" && values.effort === "" && values.unattended === false
  );
}
