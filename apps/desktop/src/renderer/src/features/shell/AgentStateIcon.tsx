/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/AgentWorkingSpinner.tsx and the state
   vocabulary of components/AgentStateDot.tsx (adapter: Orca's ten
   transcript states collapse to this repo's five AgentState values;
   no zustand, props only). */
import { CircleCheck, CircleDashed, MessageCircleQuestionMark } from "lucide-react";
import type { AgentState } from "../../../../shared/session-contract";
import { agentIconKind, agentStateLabel } from "./agent-state";

/**
 * Compact agent-state glyph shared by session tabs and worktree cards.
 * Working renders the compositor-driven spinner ring; idle a check;
 * needs_input the question badge; exited/unknown quiet dots. Callers
 * size it with className-free `size` (icon pixels).
 */
export function AgentStateIcon({
  state,
  size = 14,
}: {
  state: AgentState;
  size?: number;
}) {
  const kind = agentIconKind(state);
  const label = agentStateLabel(state);
  if (kind === "working") {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        data-agent-state={kind}
        className="shell-agent-spinner"
        style={{ width: size, height: size }}
      />
    );
  }
  if (kind === "needs-input") {
    return (
      <MessageCircleQuestionMark
        size={size}
        aria-label={label}
        data-agent-state={kind}
        className="shell-agent-needs-input"
      />
    );
  }
  if (kind === "idle") {
    return (
      <CircleCheck
        size={size}
        aria-label={label}
        data-agent-state={kind}
        className="shell-agent-idle"
      />
    );
  }
  return (
    <CircleDashed
      size={size}
      aria-label={label}
      data-agent-state={kind}
      className={
        kind === "exited" ? "shell-agent-exited" : "shell-agent-unknown"
      }
    />
  );
}
