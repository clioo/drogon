// MIT Copyright (c) 2026 Lovecast Inc.
// Work-graph aggregate metrics — the summary the old detached Metrics
// header provided, now over the graph's own state records. Honesty rules
// (non-negotiable, carried from the Mentu surface): never estimate a
// missing value; a shell node has NO token/cost fields (not applicable —
// a different thing from unavailable); an agent node's usage is reported
// or honestly unavailable; and every rendered total came from the state
// file's recorded timestamps/values, never from a projection. Cost is not
// part of the runtime's evidence schema, so it stays unavailable.

import {
  isShellHarness,
  stateNodeFor,
  type WorkGraphDocument,
  type WorkGraphStateNode,
} from "../../../../shared/work-graph-contract";

export type WorkGraphTotals = {
  nodeCount: number;
  byStatus: Record<string, number>;
  /** Nodes whose state entry records BOTH start and end: their duration
   *  is the exact difference of those recorded timestamps. */
  durationKnownCount: number;
  durationUnknownCount: number;
  durationTotalMs: number | null;
  /** Agent-node token totals. `null` = no agent node reported that field. */
  inputTokens: number | null;
  outputTokens: number | null;
  /** Agent nodes whose usage is not usable (no record or usageKnown false). */
  agentUsageUnavailableCount: number;
  /** Agent nodes with at least one recorded token field. */
  agentUsageKnownCount: number;
  /** Shell nodes: token/cost metrics are NOT APPLICABLE to them. */
  shellNodeCount: number;
};

/** A node's recorded duration, from the record alone: the run-record
 *  step's `durationSeconds` when present, else the difference of the
 *  recorded start/end timestamps, else null (unknown). */
function recordedDurationMs(node: WorkGraphStateNode | null): number | null {
  if (!node) return null;
  const seconds = node.evidence?.step?.durationSeconds;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  if (!node.startedAt || !node.endedAt) return null;
  const start = Date.parse(node.startedAt);
  const end = Date.parse(node.endedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

/** One recorded token field is usable only when it is a nonnegative finite
 *  number on a node whose usage the record marks known (or does not mark at
 *  all — older records carry no `usageKnown` flag). */
function usableToken(value: number | null | undefined, usageKnown: boolean | null | undefined): number | null {
  if (usageKnown === false) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

export function summarizeWorkGraph(document: WorkGraphDocument): WorkGraphTotals {
  const byStatus: Record<string, number> = {};
  let durationKnownCount = 0;
  let durationUnknownCount = 0;
  let durationTotalMs: number | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let agentUsageUnavailableCount = 0;
  let agentUsageKnownCount = 0;
  let shellNodeCount = 0;

  for (const intent of document.intent.nodes) {
    const state = stateNodeFor(document, intent.id);
    const status = state?.status ?? "idle";
    byStatus[status] = (byStatus[status] ?? 0) + 1;

    const duration = recordedDurationMs(state);
    if (duration !== null) {
      durationKnownCount += 1;
      durationTotalMs = (durationTotalMs ?? 0) + duration;
    } else {
      durationUnknownCount += 1;
    }

    const shell = isShellHarness(intent.harness);
    if (shell) {
      shellNodeCount += 1;
      // A shell node has no token fields at all: it contributes NOTHING to
      // token totals, not even an "unavailable" — not applicable.
      continue;
    }
    const usage = state?.evidence?.step?.usage ?? null;
    const usageKnown = usage?.usageKnown ?? null;
    const input = usableToken(usage?.inputTokens, usageKnown);
    const output = usableToken(usage?.outputTokens, usageKnown);
    if (input !== null || output !== null) {
      agentUsageKnownCount += 1;
      inputTokens = (inputTokens ?? 0) + (input ?? 0);
      outputTokens = (outputTokens ?? 0) + (output ?? 0);
    } else {
      agentUsageUnavailableCount += 1;
    }
  }

  return {
    nodeCount: document.intent.nodes.length,
    byStatus,
    durationKnownCount,
    durationUnknownCount,
    durationTotalMs,
    inputTokens,
    outputTokens,
    agentUsageUnavailableCount,
    agentUsageKnownCount,
    shellNodeCount,
  };
}

/** "1.2s" / "850ms" / "2m 03s" — display only; the source numbers stay in
 *  the state record. Null renders as the honest unavailable phrase. */
export function formatDurationMs(ms: number | null): string {
  if (ms === null) return "unavailable";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}
