// MIT Copyright (c) 2026 Lovecast Inc.
// src/renderer/src/lib/agent-catalog.tsx: source order, labels, docs and icons.
// Only adapters implemented by Drogon's independent execution core are listed.
import type { AgentId } from "../../../../shared/agent-settings-contract";
import { HarnessMenuIcon } from "../shell/TabCreateMenuIcons";
import { OpenAIIcon } from "./agent-openai-icon";
import antigravityIcon from "../../assets/agent-icons/antigravity.png";
export type AgentCatalogEntry = {
  id: AgentId;
  label: string;
  cmd: string;
  homepageUrl: string;
};
export const AGENT_CATALOG: AgentCatalogEntry[] = [
  {
    id: "claude",
    label: "Claude",
    cmd: "claude",
    homepageUrl: "https://docs.anthropic.com/en/docs/claude-code",
  },
  {
    id: "codex",
    label: "Codex",
    cmd: "codex",
    homepageUrl: "https://github.com/openai/codex",
  },
  {
    id: "opencode",
    label: "OpenCode",
    cmd: "opencode",
    homepageUrl: "https://opencode.ai",
  },
  { id: "pi", label: "Pi", cmd: "pi", homepageUrl: "https://pi.dev" },
  {
    id: "antigravity",
    label: "Antigravity",
    cmd: "agy",
    homepageUrl: "https://antigravity.google/docs/cli-overview",
  },
];
export function AgentIcon({
  agent,
  size = 14,
}: {
  agent: AgentId;
  size?: number;
}) {
  if (agent === "codex") return <OpenAIIcon size={size} />;
  if (agent === "antigravity")
    return (
      <img
        src={antigravityIcon}
        width={size}
        height={size}
        alt=""
        aria-hidden
        style={{ borderRadius: 2 }}
      />
    );
  return <HarnessMenuIcon harnessId={agent} displayName={agent} size={size} />;
}
