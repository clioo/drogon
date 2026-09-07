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
