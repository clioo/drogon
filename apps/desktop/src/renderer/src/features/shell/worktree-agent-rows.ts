/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-agent-rows.ts
   (buildWorktreeAgentRows: one row per live/retained agent attributed to
   the worktree), worktree-agent-row-order.ts (compareWorktreeAgentRows),
   worktree-agent-row-type.ts (resolveRowAgentType),
   worktree-agent-row-fallback-tab.ts (a tab with no agent entry still gets
   a row), src/renderer/src/lib/agent-row-decay-state.ts
   (agentNoUpdateLabel, formatCompactDuration),
   src/renderer/src/lib/short-time-ago.ts (formatShortTimeAgo) and
   src/shared/agent-type-label.ts (formatAgentTypeLabel).
   Adapter: Orca derives rows from hook-reported agent-status entries keyed
   by pane over zustand tabs, with subagent children, orchestration workers
   and retained done snapshots. This repo's contract has none of that: the
   daemon reports one `agentState` per Session (R16-AE #206 unified the
   derivation in `sessionDotState`, reused here unchanged), so one Session
   is exactly one row — a session that never reported still gets its
   fallback row (unknown dot, harness/shell icon, tab title, freshness
   secondary) instead of collapsing the card to a bare summary count.
   Title resolution reuses the tab strip's own functions so a row reads
   exactly what its tab reads. Pure functions, unit-tested. */
import type {
  AgentState,
  HarnessId,
  Session,
} from "../../../../shared/session-contract";
import { sessionDotState } from "./agent-state";
import { defaultTerminalTabTitle } from "./tab-title";
import {
  partitionPinnedOrder,
  reconcileTabOrder,
  resolveTabTitle,
} from "./tab-order";
import { recoveryTabLabel } from "../../session-recovery";

/** Fork-verbatim harness labels (src/shared/agent-type-label.ts). */
const HARNESS_LABELS: Record<HarnessId, string> = {
  claude: "Claude",
  pi: "Pi",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  codex: "Codex",
};

/** Label for a row's harness identity; plain shells read `Shell`. */
export function formatRowHarnessLabel(harnessId: HarnessId | null): string {
  if (harnessId === null) return "Shell";
  return HARNESS_LABELS[harnessId] ?? harnessId;
}

/**
 * Coarse `34m` / `2h` / `3d` duration, floored so it never overstates the
 * gap (fork's formatCompactDuration verbatim).
 */
export function formatCompactDuration(deltaMs: number): string {
  const minutes = Math.max(0, Math.floor(deltaMs / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Compact "now / 5m / 3h / 2d" age label (fork's formatShortTimeAgo
 * verbatim) — the row timestamp in the issue (`22m`).
 */
export function formatShortTimeAgo(ts: number, now: number = Date.now()): string {
  const delta = now - ts;
  if (delta < 60_000) return "now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * The observer's freshness report for a row whose agent is not reporting
 * (fork's agentNoUpdateLabel verbatim): what was last heard and how long
 * the silence has run, never a claim about what the agent is doing.
 */
export function agentNoUpdateLabel(evidenceMs: number, now: number): string {
  return `No update in ${formatCompactDuration(now - evidenceMs)}`;
}

/** Last-heard millisecond for a session; falls back to creation. */
export function rowEvidenceMs(session: Session): number {
  const at = session.agentStateAt ? Date.parse(session.agentStateAt) : NaN;
  if (!Number.isNaN(at)) return at;
  const created = Date.parse(session.createdAt);
  return Number.isNaN(created) ? 0 : created;
}

/** Creation millisecond for ordering; unparseable sorts first. */
function rowCreatedMs(session: Session): number {
  const created = Date.parse(session.createdAt);
  return Number.isNaN(created) ? 0 : created;
}

/** Basename of the session command (session-label.ts fallback verbatim). */
function commandBasename(session: Session): string {
  return session.command.split(/[\\/]/).at(-1) || "Terminal";
}

/**
 * Secondary row text (the fork's CompactAgentRow secondary slot): the
 * freshness report while the agent is not reporting, otherwise the
 * harness identity for agent sessions and the command basename for plain
 * shells.
 */
export function resolveRowSecondary(session: Session, now: number): string {
  const state = sessionDotState(session);
  if (state === "unknown") return agentNoUpdateLabel(rowEvidenceMs(session), now);
  if (session.harnessId) return formatRowHarnessLabel(session.harnessId);
  return commandBasename(session);
}

/**
 * Row order (fork's compareWorktreeAgentRows adapted): the source sorts by
 * agent startedAt, tab sortOrder/createdAt, then pane key. Sessions carry
 * no pane keys or per-tab records, so creation time then session id is the
 * whole deterministic order.
 */
export function compareWorktreeAgentRows(a: Session, b: Session): number {
  return (
    rowCreatedMs(a) - rowCreatedMs(b) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export type WorktreeAgentRow = {
  session: Session;
  /** Dot state via the shared `sessionDotState` derivation. */
  state: AgentState;
  /** Tab title, resolved exactly like the strip (rename wins). */
  title: string;
  /** Freshness report or harness/command identity. */
  secondary: string;
  /** Compact age (`22m`) of the last report, or "" when unknowable. */
  relativeTime: string;
  /** True when this row's tab is the active one (focused highlight). */
  focused: boolean;
};

export type WorktreeAgentRowInputs = {
  /** Stored strip order (session ids); absent keeps creation order only. */
  stripOrder?: readonly string[];
  /** Pinned tab ids, rendered first like the strip. */
  pinnedIds?: readonly string[] | ReadonlySet<string>;
  /** Custom session titles from the rename affordance. */
  customTitles?: Record<string, string>;
  /** Active session tab id for the focused-row highlight. */
  activeSessionId?: string;
  nowMs?: number;
};

/**
 * One nested card row per session, in row order. The caller passes the
 * sessions attached to one worktree (already strip-filtered); every
 * session yields a row, including one that never reported — that fallback
 * row is what the fork's `tabFromWorktreeAttributedStatusEntry` provides
 * for tabs with no agent entry.
 */
export function buildWorktreeAgentRows(
  sessions: Session[],
  inputs: WorktreeAgentRowInputs = {},
): WorktreeAgentRow[] {
  const now = inputs.nowMs ?? Date.now();
  const ordered = [...sessions].sort(compareWorktreeAgentRows);
  // Title numbering reuses the strip's own order reconciliation (same
  // functions TabBar numbers "Terminal N" with), so the row title is the
  // tab title character for character.
  const stripSequence = partitionPinnedOrder(
    reconcileTabOrder(
      inputs.stripOrder,
      ordered.map((session) => session.id),
    ),
    inputs.pinnedIds ?? [],
  );
  const positionById = new Map<string, number>();
  stripSequence.forEach((id, index) => {
    if (!positionById.has(id)) positionById.set(id, index + 1);
  });
  const customTitles = inputs.customTitles ?? {};
  return ordered.map((session) => {
    const evidenceMs = rowEvidenceMs(session);
    const title = recoveryTabLabel({
      label: resolveTabTitle(
        session.id,
        defaultTerminalTabTitle(positionById.get(session.id) ?? 1),
        customTitles,
      ),
      verdict: session.verdict,
      id: session.id,
      incarnation: session.incarnation,
    });
    return {
      session,
      state: sessionDotState(session),
      title,
      secondary: resolveRowSecondary(session, now),
      relativeTime: evidenceMs > 0 ? formatShortTimeAgo(evidenceMs, now) : "",
      focused: session.id === inputs.activeSessionId,
    };
  });
}
