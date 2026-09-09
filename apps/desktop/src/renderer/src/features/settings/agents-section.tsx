// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from components/settings/AgentsPane.tsx. Native RPC replaces the
// source's zustand/IPC data layer; local Drogon adapters own detection/launch.
import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import type { Harness } from "../../../../shared/session-contract";
import type { HarnessAgentDefault } from "../../settings-store";
import { AGENT_SETTINGS_DEFAULTS } from "../../../../shared/agent-settings-contract";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import { Button } from "../../components/ui/button";
import { SettingsSection } from "./SettingsSection";
import {
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow,
} from "./SettingsFormControls";
import { AgentDefaultSetting } from "./AgentDefaultSetting";
import { AgentDetectionCatalog } from "./AgentDetectionCatalog";
import { AgentAwakeSetting } from "./AgentAwakeSetting";
import { AgentCacheTimerSection } from "./AgentCacheTimerSection";
import { AGENT_CATALOG } from "./agent-catalog";
import {
  agentSettingsState,
  saveAgentSettings,
  useAgentSettings,
} from "./agent-settings-state";
import {
  applyAgentPermissionMode,
  resolveAgentPermissionModeSummary,
} from "./agent-permissions";

export const KNOWN_HARNESS_IDS = [
  "claude",
  "pi",
  "opencode",
  "antigravity",
  "codex",
] as const;
export function harnessDisplayName(id: string, harnesses: Harness[]): string {
  return (
    harnesses.find((harness) => harness.harnessId === id)?.displayName ??
    AGENT_CATALOG.find((agent) => agent.id === id)?.label ??
    id
  );
}
export function agentEditorIds(harnesses: Harness[]): string[] {
  return [
    ...new Set([
      ...harnesses.map((harness) => harness.harnessId),
      ...KNOWN_HARNESS_IDS,
    ]),
  ];
}
export function AgentsSection(props: {
  harnesses: Harness[];
  defaultHarnessId: string;
  onDefaultHarnessChange: (id: string) => void;
  harnessDefaults: Record<string, HarnessAgentDefault>;
  onHarnessDefaultChange: (id: string, value: HarnessAgentDefault) => void;
  /** User-feature-closure item 7: whether the attached daemon advertises
   *  agent.settings.v1 (App.tsx wires isAgentSettingsAvailable over the
   *  live status capabilities). Omitted (or true) renders unchanged --
   *  only an explicit false, meaning a mixed-version old daemon is
   *  attached, shows the notice below. The panel keeps rendering either
   *  way: a capability gap is surfaced, never a reason to hide settings
   *  or restart anything automatically. */
  capabilityAvailable?: boolean;
}) {
  const { settings, ready, saving, error } = useAgentSettings();
  const [detected, setDetected] = useState<Harness[] | null>(
    props.harnesses.length ? props.harnesses : null,
  );
  const [detectionFailed, setDetectionFailed] = useState(false);
  const [isRefreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);
    void (async () => {
      try {
        const result = await window.drogon.harnesses();
        if (cancelled) return;
        if (!result.ok) throw new Error(result.error.message);
        setDetected(result.result.harnesses);
        setDetectionFailed(false);
      } catch {
        if (!cancelled) setDetectionFailed(true);
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, settings.agentCmdOverrides]);
  useEffect(() => {
    if (!ready) void agentSettingsState.load();
  }, [ready]);
  const detectedIds =
    detected === null
      ? null
      : new Set(
          detected
            .filter((agent) => agent.availability === "available")
            .map((agent) => agent.harnessId),
        );
  const detectedAgents = AGENT_CATALOG.filter((agent) =>
    detectedIds?.has(agent.id),
  );
  const enabledDetectedAgents = detectedAgents.filter(
    (agent) => !settings.disabledTuiAgents.includes(agent.id),
  );
  const mode = resolveAgentPermissionModeSummary(settings);
  return (
    <SettingsSection
      id="agents"
      title="Agents"
      description="Manage AI agents, set a default, and customize commands."
    >
      {props.capabilityAvailable === false && (
        <div
          role="status"
          className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground"
        >
          This Drogon service is running an older version that does not
          support Agent settings yet. Restart the app to pick up the update
          — your current sessions stay untouched until you do.
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center justify-between gap-3 text-xs text-destructive"
        >
          {error}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void agentSettingsState.load()}
          >
            Retry
          </Button>
        </div>
      )}
      <fieldset
        disabled={!ready}
        className="min-w-0 space-y-8"
        aria-busy={saving || !ready}
      >
        <AgentDefaultSetting
          defaultAgent={settings.defaultTuiAgent}
          detectedIds={detectedIds}
          enabledDetectedAgents={enabledDetectedAgents}
          catalog={AGENT_CATALOG}
          description="Default agent, command overrides, CLI arguments, and launch environment are client preferences. SSH and remote server launches still validate host availability at run time."
          onSetDefault={(agent) =>
            saveAgentSettings({ defaultTuiAgent: agent })
          }
        />
        <section className="space-y-3">
          <SettingsSwitchRow
            label="Agent status hooks"
            description="Shows working, waiting, and done states in Drogon. Turn off to remove Drogon-managed hooks and stop reinstalling them."
            checked={settings.agentStatusHooksEnabled}
            onChange={(value) =>
              saveAgentSettings({ agentStatusHooksEnabled: value })
            }
          />
        </section>
        <section className="space-y-3">
          <SettingsSwitchRow
            label="Auto-generate tab titles"
            description="Derive short stable tab names from the first known agent prompt. Manual renames always win."
            checked={settings.tabAutoGenerateTitle}
            onChange={(value) =>
              saveAgentSettings({ tabAutoGenerateTitle: value })
            }
          />
        </section>
        <AgentAwakeSetting />
        <AgentCacheTimerSection
          settings={settings}
          updateSettings={saveAgentSettings}
        />
        <section className="space-y-3">
          <SettingsSubsectionHeader
            title={
              <span className="flex items-center gap-2">
                Agent Permissions
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Agent permissions info"
                      className="grid size-5 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <Info className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6}>
                    Doesn't apply to agents where you've overridden launch
                    arguments.
                  </TooltipContent>
                </Tooltip>
              </span>
            }
            description="Choose whether Drogon launches agents with fewer permission prompts or with manual checks."
            action={
              <SettingsSegmentedControl
                value={mode === "manual" ? "manual" : "yolo"}
                onChange={(mode) =>
                  saveAgentSettings((latest) =>
                    applyAgentPermissionMode(latest, mode),
                  )
                }
                ariaLabel="Agent Permissions"
                size="sm"
                options={[
                  { value: "yolo", label: "Yolo" },
                  { value: "manual", label: "Manual" },
                ]}
              />
            }
          />
        </section>
        <AgentDetectionCatalog
          detectedAgents={detectedAgents}
          undetectedAgents={AGENT_CATALOG.filter(
            (agent) => detectedIds !== null && !detectedIds.has(agent.id),
          )}
          detectionPending={detectedIds === null}
          detectionFailed={detectionFailed}
          isRefreshing={isRefreshing}
          activeServerEnvironmentId={null}
          activeServerName={null}
          onRefresh={() => setRefreshKey((key) => key + 1)}
          getRowProps={(agent, isDetected) => ({
            agentId: agent.id,
            label: agent.label,
            homepageUrl: agent.homepageUrl,
            defaultCmd: agent.cmd,
            defaultArgs:
              AGENT_SETTINGS_DEFAULTS.agentDefaultArgs[agent.id] ?? "",
            defaultEnv: {},
            isDetected,
            isEnabled: !settings.disabledTuiAgents.includes(agent.id),
            isDefault: settings.defaultTuiAgent === agent.id,
            cmdOverride: settings.agentCmdOverrides[agent.id],
            argsOverride: settings.agentDefaultArgs[agent.id] ?? "",
            envOverride: settings.agentDefaultEnv[agent.id] ?? {},
            onSetDefault: () =>
              saveAgentSettings({ defaultTuiAgent: agent.id }),
            onSetEnabled: (enabled) =>
              saveAgentSettings((latest) => ({
                disabledTuiAgents: enabled
                  ? latest.disabledTuiAgents.filter((id) => id !== agent.id)
                  : [...new Set([...latest.disabledTuiAgents, agent.id])],
              })),
            onSaveOverride: (value) =>
              saveAgentSettings({
                agentCmdOverrides: { [agent.id]: value || null },
              }),
            onSaveArgs: (value) =>
              saveAgentSettings({ agentDefaultArgs: { [agent.id]: value } }),
            onSaveEnv: (value) =>
              saveAgentSettings({ agentDefaultEnv: { [agent.id]: value } }),
            sessionSourceHome:
              isDetected && agent.id === "codex"
                ? {
                    runtimeLabel: "~/.codex",
                    value: settings.codexSessionSourceHome,
                    onSave: (value) =>
                      saveAgentSettings({ codexSessionSourceHome: value }),
                  }
                : undefined,
          })}
        />
      </fieldset>
    </SettingsSection>
  );
}
