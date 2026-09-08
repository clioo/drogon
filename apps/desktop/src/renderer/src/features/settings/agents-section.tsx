import { useState } from "react";
import { Input } from "../../components/ui/input";
import type { Harness } from "../../../../shared/session-contract";
import type { HarnessAgentDefault } from "../../settings-store";
import {
  buildHarnessAgentDefault,
  resolveLaunchDefaults,
  validateAgentDefaultField,
} from "./agent-defaults";
import {
  PI_MODEL_HELPER,
  resolvePiModelField,
} from "../shell/pi-model-mapping";
import {
  SettingsFieldError,
  SettingsRow,
  SettingsSection,
  SettingsSegmentedControl,
} from "./settings-rows";

/** Adapter ids the harness bridge accepts (bridge-validation.ts). */
export const KNOWN_HARNESS_IDS = [
  "claude",
  "pi",
  "opencode",
  "antigravity",
] as const;

const KNOWN_DISPLAY_NAMES: Record<string, string> = {
  claude: "Claude Code",
  pi: "Pi",
  opencode: "OpenCode",
  antigravity: "Antigravity",
};

export function harnessDisplayName(
  harnessId: string,
  harnesses: Harness[],
): string {
  return (
    harnesses.find((harness) => harness.harnessId === harnessId)?.displayName ??
    KNOWN_DISPLAY_NAMES[harnessId] ??
    harnessId
  );
}

/** Every harness id worth editing: live ones first, then the known rest. */
export function agentEditorIds(harnesses: Harness[]): string[] {
  const live = harnesses.map((harness) => harness.harnessId);
  return [...live, ...KNOWN_HARNESS_IDS.filter((id) => !live.includes(id))];
}

export function AgentsSection({
  harnesses,
  defaultHarnessId,
  onDefaultHarnessChange,
  harnessDefaults,
  onHarnessDefaultChange,
}: {
  harnesses: Harness[];
  defaultHarnessId: string;
  onDefaultHarnessChange: (harnessId: string) => void;
  harnessDefaults: Record<string, HarnessAgentDefault>;
  onHarnessDefaultChange: (
    harnessId: string,
    next: HarnessAgentDefault,
  ) => void;
}): React.JSX.Element {
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const editorIds = agentEditorIds(harnesses);
  return (
    <SettingsSection
      id="agents"
      title="Agents"
      description="The default harness pre-fills the “+” launch form; per-harness values are used unless you override them there. Empty model or effort means the harness default."
    >
      <SettingsRow
        label="Default harness"
        description="Marked in the launch menu; blank fields there fall back to the values below."
        alignTop
        control={
          <SettingsSegmentedControl<string>
            ariaLabel="Default harness"
            value={defaultHarnessId}
            onChange={onDefaultHarnessChange}
            options={[
              { value: "", label: "None" },
              ...editorIds.map((id) => ({
                value: id,
                label: harnessDisplayName(id, harnesses),
              })),
            ]}
          />
        }
      />
      {editorIds.map((harnessId) => {
        const resolved = resolveLaunchDefaults(harnessId, harnessDefaults);
        const setField = (field: "model" | "effort", value: string) => {
          // #221: a Pi default flows straight into `harness.start`, so it
          // must already satisfy the fork's `provider/model` shape — the
          // fork's error shows inline instead of an "Invalid model"
          // refusal at launch time.
          const mapped =
            field === "model" && harnessId === "pi"
              ? resolvePiModelField({ harnessId: "pi", model: value, provider: "" })
              : null;
          const error =
            validateAgentDefaultField(field, value) ??
            (mapped && "error" in mapped ? mapped.error : null);
          setErrors((prev) => ({
            ...prev,
            [`${harnessId}.${field}`]: error,
          }));
          if (error) return;
          onHarnessDefaultChange(
            harnessId,
            buildHarnessAgentDefault({ ...resolved, [field]: value }),
          );
        };
        return (
          <fieldset key={harnessId} className="settings-agent-block">
            <legend className="settings-agent-title">
              {harnessDisplayName(harnessId, harnesses)}
              {defaultHarnessId === harnessId ? (
                <span className="settings-agent-default-badge">Default</span>
              ) : null}
            </legend>
            <SettingsRow
              label="Model"
              description={
                harnessId === "pi" ? PI_MODEL_HELPER : undefined
              }
              control={
                <Input
                  aria-label={`${harnessDisplayName(harnessId, harnesses)} model`}
                  placeholder="Harness default"
                  value={resolved.model}
                  onChange={(event) => setField("model", event.target.value)}
                />
              }
            />
            <SettingsFieldError
              message={errors[`${harnessId}.model`] ?? null}
            />
            <SettingsRow
              label="Effort"
              control={
                <Input
                  aria-label={`${harnessDisplayName(harnessId, harnesses)} effort`}
                  placeholder="Harness default"
                  value={resolved.effort}
                  onChange={(event) => setField("effort", event.target.value)}
                />
              }
            />
            <SettingsFieldError
              message={errors[`${harnessId}.effort`] ?? null}
            />
            <SettingsRow
              label="Permissions"
              control={
                <SettingsSegmentedControl<"inherit" | "unattended">
                  value={resolved.unattended ? "unattended" : "inherit"}
                  onChange={(mode) =>
                    onHarnessDefaultChange(
                      harnessId,
                      buildHarnessAgentDefault({
                        ...resolved,
                        unattended: mode === "unattended",
                      }),
                    )
                  }
                  options={[
                    { value: "inherit", label: "Ask" },
                    { value: "unattended", label: "Unattended" },
                  ]}
                  ariaLabel={`${harnessDisplayName(harnessId, harnesses)} permission mode`}
                />
              }
            />
          </fieldset>
        );
      })}
    </SettingsSection>
  );
}
