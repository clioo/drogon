// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from src/renderer/src/components/settings/AgentCatalogRow.tsx; Drogon data adapter.
import { useState } from "react";
import { windowShellOpenExternal } from "../landing/github-star";
import { Check, ChevronDown, ExternalLink } from "lucide-react";
import type { AgentId as TuiAgent } from "../../../../shared/agent-settings-contract";
import { AgentIcon } from "./agent-catalog";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import {
  SettingsBadge,
  SettingsSegmentedControl,
} from "./SettingsFormControls";
import type { AgentSessionSourceHomeControl } from "./codex-session-source-home-control";
import { AgentSessionSourceHomeInput } from "./codex-session-source-home-control";
import { stringifyAgentDefaultEnvDraft } from "./agent-default-env-draft";
import {
  AgentCommandOverrideInput,
  AgentDefaultArgsInput,
  AgentDefaultEnvInput,
} from "./AgentLaunchDefaultsEditor";

type AgentAvailability = "enabled" | "disabled";

export function AgentAvailabilityControl({
  label,
  isEnabled,
  onSetEnabled,
}: {
  label: string;
  isEnabled: boolean;
  onSetEnabled: (enabled: boolean) => void;
}): React.JSX.Element {
  const value: AgentAvailability = isEnabled ? "enabled" : "disabled";
  return (
    <SettingsSegmentedControl<AgentAvailability>
      value={value}
      onChange={(next) => {
        if (next !== value) {
          onSetEnabled(next === "enabled");
        }
      }}
      ariaLabel={"{{value0}} availability".replace("{{value0}}", String(label))}
      size="sm"
      options={[
        {
          value: "enabled",
          label: "Enabled",
        },
        {
          value: "disabled",
          label: "Disabled",
        },
      ]}
    />
  );
}

export type AgentCatalogRowProps = {
  agentId: TuiAgent;
  label: string;
  homepageUrl: string;
  defaultCmd: string;
  defaultArgs: string;
  defaultEnv: Record<string, string>;
  isDetected: boolean;
  isEnabled: boolean;
  isDefault: boolean;
  cmdOverride: string | undefined;
  argsOverride: string;
  envOverride: Record<string, string>;
  onSetDefault: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onSaveOverride: (value: string) => void;
  onSaveArgs: (value: string) => void;
  onSaveEnv: (value: Record<string, string>) => void;
  sessionSourceHome?: AgentSessionSourceHomeControl;
};

export function AgentCatalogRow({
  agentId,
  label,
  homepageUrl,
  defaultCmd,
  defaultArgs,
  defaultEnv,
  isDetected,
  isEnabled,
  isDefault,
  cmdOverride,
  argsOverride,
  envOverride,
  onSetDefault,
  onSetEnabled,
  onSaveOverride,
  onSaveArgs,
  onSaveEnv,
  sessionSourceHome,
}: AgentCatalogRowProps): React.JSX.Element {
  const envSummary = stringifyAgentDefaultEnvDraft(envOverride);
  const defaultEnvSummary = stringifyAgentDefaultEnvDraft(defaultEnv);
  const [cmdOpen, setCmdOpen] = useState(
    Boolean(cmdOverride) ||
      argsOverride !== defaultArgs ||
      envSummary !== defaultEnvSummary,
  );

  return (
    <div
      data-agent-id={agentId}
      className={cn("py-3", !isDetected && "opacity-70")}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/50 bg-background/50">
          <AgentIcon agent={agentId} size={16} />
        </div>
        <div className="min-w-0 flex-1 sm:min-w-[12rem]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium leading-none">{label}</span>
            {!isEnabled && (
              <SettingsBadge tone="muted">{"Disabled"}</SettingsBadge>
            )}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {cmdOverride ? (
              <span>
                <span className="text-muted-foreground/60 line-through">
                  {defaultCmd}
                </span>
                <span className="ml-1.5 text-foreground/80">{cmdOverride}</span>
              </span>
            ) : (
              defaultCmd
            )}
            {argsOverride && (
              <span className="ml-1.5 text-foreground/70">{argsOverride}</span>
            )}
            {envSummary && (
              <span className="ml-1.5 text-foreground/60">{envSummary}</span>
            )}
          </div>
        </div>

        <div className="ml-auto grid shrink-0 grid-cols-[max-content_6.5rem_1.75rem_1.75rem] items-center gap-1.5">
          <AgentAvailabilityControl
            label={label}
            isEnabled={isEnabled}
            onSetEnabled={onSetEnabled}
          />
          <div className="flex justify-start">
            {isDetected && isEnabled && (
              <Button
                type="button"
                variant={isDefault ? "secondary" : "ghost"}
                size="xs"
                onClick={onSetDefault}
                title={isDefault ? "Default agent" : "Set as default"}
                className="h-7 w-full justify-center gap-1 text-xs"
              >
                {isDefault && <Check className="size-3" />}
                {isDefault ? "Default" : "Set default"}
              </Button>
            )}
          </div>
          <a
            onClick={(event) => {
              event.preventDefault();
              void windowShellOpenExternal(window.drogon)?.(homepageUrl);
            }}
            href={homepageUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={isDetected ? "Docs" : "Install"}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
          <div className="flex size-7 items-center justify-center">
            {isDetected && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setCmdOpen((previous) => !previous)}
                aria-expanded={cmdOpen}
                aria-label={
                  cmdOpen
                    ? "Collapse command override"
                    : "Expand command override"
                }
                className="size-7 text-muted-foreground hover:text-foreground"
              >
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform",
                    cmdOpen && "rotate-180",
                  )}
                />
              </Button>
            )}
          </div>
        </div>
      </div>

      {isDetected && cmdOpen && (
        <div className="mt-3 pl-10">
          <AgentCommandOverrideInput
            key={cmdOverride ?? defaultCmd}
            defaultCmd={defaultCmd}
            cmdOverride={cmdOverride}
            onSaveOverride={onSaveOverride}
          />
          <div className="mt-2">
            <AgentDefaultArgsInput
              key={`${agentId}:${argsOverride}`}
              defaultArgs={defaultArgs}
              argsOverride={argsOverride}
              onSaveArgs={onSaveArgs}
            />
          </div>
          <div className="mt-2">
            <AgentDefaultEnvInput
              key={`${agentId}:${envSummary}`}
              defaultEnv={defaultEnv}
              envOverride={envOverride}
              onSaveEnv={onSaveEnv}
            />
          </div>
          {sessionSourceHome && (
            <div className="mt-2">
              <AgentSessionSourceHomeInput
                key={`${agentId}:${sessionSourceHome.runtimeLabel}:${sessionSourceHome.value}`}
                runtimeLabel={sessionSourceHome.runtimeLabel}
                value={sessionSourceHome.value}
                onSave={sessionSourceHome.onSave}
              />
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            {
              "Override the binary path or name, and edit the default launch arguments or environment for this agent."
            }
          </p>
        </div>
      )}
    </div>
  );
}
