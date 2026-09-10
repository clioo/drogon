import type {
  HarnessId,
  HarnessLaunchInput,
  PermissionMode,
} from "../../shared/session-contract";

export type HarnessLaunchFormValues = {
  model: string;
  provider: string;
  effort: string;
  prompt: string;
  unattended: boolean;
};

export function emptyHarnessLaunchForm(): HarnessLaunchFormValues {
  return { model: "", provider: "", effort: "", prompt: "", unattended: false };
}

function optionalField(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * A blank field means "no preference" and must reach the service as an
 * absent key (harness default), never as an empty string. `provider` is
 * Pi-only per `harness-contract-v1.md`; dropped here too so a stray value
 * left over from switching harnesses in the form never leaks through.
 */
export type HarnessLaunchParams = Omit<HarnessLaunchInput, "requestId">;

/**
 * Per-harness accepted effort levels. Mirrors `allowed_efforts` in
 * `crates/drogon-harness/src/selection.rs` (which itself mirrors the
 * `plan_launch` argv adapter, the final authority): OpenCode advertises
 * no effort flag, so any effort there refuses. This table only decides
 * what the form layer advertises — the daemon gate re-checks.
 */
export const ALLOWED_EFFORT_LEVELS: Record<HarnessId, readonly string[]> = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  pi: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  opencode: [],
  antigravity: ["low", "medium", "high"],
  codex: ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
};

/**
 * Absent/blank effort means "harness default" and always passes; a present
 * one must be advertised for the harness, compared verbatim like the
 * daemon gate (surrounding-whitespace trimming happens upstream in
 * `normalizeHarnessLaunchInput`, never here).
 */
export function isEffortSupported(
  harnessId: HarnessId,
  effort: string | undefined,
): boolean {
  if (effort === undefined || effort === "") return true;
  return ALLOWED_EFFORT_LEVELS[harnessId].includes(effort);
}

/** Provider selection is Pi-only, mirroring `plan_launch` and the daemon selection gate. */
export function isProviderSupported(harnessId: HarnessId): boolean {
  return harnessId === "pi";
}

function selectionShapeError(value: string): string | null {
  // Mirrors the daemon gate's shape checks (`plan_launch`-compatible:
  // 1..512 bytes, no control characters, never leading `-`).
  const bytes = new TextEncoder().encode(value).length;
  if (bytes === 0 || bytes > 512) return "must be 1..512 bytes";
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f-\x9f]/.test(value))
    return "must not contain control characters";
  if (value.startsWith("-")) return "must not start with '-'";
  return null;
}

export type LaunchSelectionAssurance =
  /**
   * The service lists binaries only (no per-model enumeration), so a
   * shape-valid selection cannot be host-confirmed: the id rides
   * unverified, exactly the daemon gate's `ManualUnverified` posture —
   * never an invented confirmation.
   */
  | { kind: "manual_unverified"; reason: string }
  /** Refused without substitution, like the daemon gate (same field vocabulary). */
  | { kind: "refused"; field: "provider" | "model" | "effort"; reason: string };

/**
 * Assesses EFFECTIVE selection values (as produced by
 * `normalizeHarnessLaunchInput`: blanks already absent, provider already
 * Pi-only) against the selection rules, without inventing enumeration.
 * Pure data adapter for the future form UI; not yet wired into any menu
 * (held composition). Explicit ids pass through verbatim — an unknown id
 * is `manual_unverified`, never refuted without a real host catalog.
 */
export function assessLaunchSelection(
  harnessId: HarnessId,
  selection: { model?: string; provider?: string; effort?: string },
): LaunchSelectionAssurance {
  if (selection.provider !== undefined && !isProviderSupported(harnessId)) {
    return {
      kind: "refused",
      field: "provider",
      reason: "Provider selection is available only for Pi",
    };
  }
  for (const field of ["provider", "model", "effort"] as const) {
    const value = selection[field];
    if (value !== undefined) {
      const shape = selectionShapeError(value);
      if (shape)
        return { kind: "refused", field, reason: `Invalid ${field}: ${shape}` };
    }
  }
  if (
    selection.effort !== undefined &&
    !isEffortSupported(harnessId, selection.effort)
  ) {
    return {
      kind: "refused",
      field: "effort",
      reason: "Unsupported effort for this harness",
    };
  }
  return {
    kind: "manual_unverified",
    reason:
      "no host catalog is owned by the daemon yet; the id is carried unverified",
  };
}

/** Boolean wrapper for menu-gating call sites (held handover wires it). */
export function isLaunchSelectionSupported(
  harnessId: HarnessId,
  selection: { model?: string; provider?: string; effort?: string },
): boolean {
  return (
    assessLaunchSelection(harnessId, selection).kind === "manual_unverified"
  );
}

/** `requestId` is attempt-tracking metadata the caller attaches separately (see `TabCreateMenu`), not a form value — this produces everything else. */
export function normalizeHarnessLaunchInput(
  workspaceId: string,
  harnessId: HarnessId,
  values: HarnessLaunchFormValues,
): HarnessLaunchParams {
  const permissionMode: PermissionMode = values.unattended
    ? "unattended"
    : "inherit";
  return {
    workspaceId,
    harnessId,
    model: optionalField(values.model),
    provider: harnessId === "pi" ? optionalField(values.provider) : undefined,
    effort: optionalField(values.effort),
    prompt: values.prompt.trim() ? values.prompt : undefined,
    permissionMode,
  };
}
