// MIT Copyright (c) 2026 Lovecast Inc.
// Port of shared/tui-agent-permissions.ts for Drogon's supported adapters.
import {
  AGENT_SETTINGS_DEFAULTS,
  type AgentSettings,
  type AgentSettingsUpdate,
} from "../../../../shared/agent-settings-contract";
export type AgentPermissionMode = "yolo" | "manual" | "mixed";
export function resolveAgentPermissionModeSummary(
  settings: AgentSettings,
): AgentPermissionMode {
  const modes = Object.entries(AGENT_SETTINGS_DEFAULTS.agentDefaultArgs).map(
    ([id, yolo]) => {
      const args =
        settings.agentDefaultArgs[
          id as keyof typeof settings.agentDefaultArgs
        ]?.trim() ?? "";
      return !args ? "manual" : args === yolo ? "yolo" : "mixed";
    },
  );
  return modes.every((mode) => mode === "manual")
    ? "manual"
    : modes.every((mode) => mode === "yolo")
      ? "yolo"
      : "mixed";
}
export function applyAgentPermissionMode(
  settings: AgentSettings,
  mode: "yolo" | "manual",
): AgentSettingsUpdate {
  const args: AgentSettings["agentDefaultArgs"] = {};
  for (const [id, yolo] of Object.entries(
    AGENT_SETTINGS_DEFAULTS.agentDefaultArgs,
  )) {
    const key = id as keyof typeof args;
    const current = settings.agentDefaultArgs[key]?.trim() ?? "";
    if (!current || current === yolo) args[key] = mode === "yolo" ? yolo : "";
  }
  return { agentDefaultArgs: args };
}
