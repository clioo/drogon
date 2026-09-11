// MIT Copyright (c) 2026 Lovecast Inc.
// Aggregate-metrics tests: the honesty rules are the point. Shell nodes
// contribute NO token totals (not applicable), an agent node's usage is
// summed only when recorded and known, missing values count as
// unavailable — never estimated — and duration comes only from recorded
// start/end pairs. Cost is always unavailable because no record carries
// it.

import { describe, expect, it } from "vitest";
import type { WorkGraphDocument } from "../../../../shared/work-graph-contract";
import { formatDurationMs, summarizeWorkGraph } from "./work-graph-metrics";

function documentWith(
  intent: WorkGraphDocument["intent"]["nodes"],
  state: WorkGraphDocument["state"]["nodes"],
): WorkGraphDocument {
  return {
    version: 1,
    intent: { nodes: intent },
    state: { updatedAt: "2026-09-11T12:00:00.000Z", nodes: state },
  };
}

const agent = {
  id: "agent-1",
  title: "Agent node",
  harness: "pi",
  model: "qwen3.8-flash-next-nvidia-nvfp4",
  dependsOn: [],
  prompt: "",
  enabled: true,
};
const shell = {
  id: "shell-1",
  title: "Shell node",
  harness: "shell",
  model: "",
  dependsOn: [],
  prompt: "",
  enabled: true,
};

describe("summarizeWorkGraph", () => {
  it("sums recorded durations from state timestamps and counts unknowns", () => {
    const totals = summarizeWorkGraph(
      documentWith(
        [agent, { ...agent, id: "agent-2", title: "Two" }],
        [
          {
            id: "agent-1",
            status: "succeeded",
            evidence: { step: { label: "agent-1", backend: "pi", status: "succeeded", durationSeconds: 60 } },
          },
          { id: "agent-2", status: "running", startedAt: "2026-09-11T11:59:30.000Z" },
        ],
      ),
    );
    expect(totals.durationTotalMs).toBe(60_000);
    expect(totals.durationKnownCount).toBe(1);
    expect(totals.durationUnknownCount).toBe(1);
  });

  it("treats token usage of shell nodes as NOT APPLICABLE — never unavailable", () => {
    const totals = summarizeWorkGraph(
      documentWith([shell], [{ id: "shell-1", status: "succeeded", evidence: { exitCode: 0 } }]),
    );
    expect(totals.shellNodeCount).toBe(1);
    expect(totals.inputTokens).toBeNull();
    expect(totals.outputTokens).toBeNull();
    // A shell-only graph must not report agent usage as unavailable.
    expect(totals.agentUsageUnavailableCount).toBe(0);
    expect(totals.agentUsageKnownCount).toBe(0);
  });

  it("sums agent usage only from recorded, known values", () => {
    const totals = summarizeWorkGraph(
      documentWith(
        [agent, { ...agent, id: "agent-2" }, { ...agent, id: "agent-3" }],
        [
          {
            id: "agent-1",
            status: "succeeded",
            evidence: {
              step: { label: "agent-1", backend: "pi", status: "succeeded",
                usage: { inputTokens: 120, outputTokens: 45, usageKnown: true, invalid: [] } },
            },
          },
          {
            id: "agent-2",
            status: "succeeded",
            evidence: {
              step: { label: "agent-2", backend: "pi", status: "succeeded",
                usage: { inputTokens: 10, outputTokens: 5, usageKnown: true, invalid: [] } },
            },
          },
          { id: "agent-3", status: "failed" },
        ],
      ),
    );
    expect(totals.inputTokens).toBe(130);
    expect(totals.outputTokens).toBe(50);
    expect(totals.agentUsageKnownCount).toBe(2);
    expect(totals.agentUsageUnavailableCount).toBe(1);
  });

  it("refuses to sum usage the record itself marks not known", () => {
    const totals = summarizeWorkGraph(
      documentWith([agent], [
        {
          id: "agent-1",
          status: "succeeded",
          evidence: {
            step: { label: "agent-1", backend: "pi", status: "succeeded",
              usage: { inputTokens: 999, outputTokens: 999, usageKnown: false, invalid: [] } },
          },
        },
      ]),
    );
    expect(totals.inputTokens).toBeNull();
    expect(totals.agentUsageUnavailableCount).toBe(1);
  });

  it("counts a recorded measured zero (usageKnown true) as zero, not unavailable", () => {
    const totals = summarizeWorkGraph(
      documentWith([agent], [
        {
          id: "agent-1",
          status: "succeeded",
          evidence: {
            step: { label: "agent-1", backend: "pi", status: "succeeded",
              usage: { inputTokens: 0, outputTokens: 0, usageKnown: true, invalid: [] } },
          },
        },
      ]),
    );
    expect(totals.inputTokens).toBe(0);
    expect(totals.outputTokens).toBe(0);
    expect(totals.agentUsageKnownCount).toBe(1);
  });

  it("projects every node's status, idle when the daemon has no entry", () => {
    const totals = summarizeWorkGraph(
      documentWith(
        [agent, shell, { ...agent, id: "agent-2" }],
        [
          { id: "agent-1", status: "running" },
          { id: "shell-1", status: "unverifiable" },
        ],
      ),
    );
    expect(totals.byStatus).toEqual({ running: 1, unverifiable: 1, idle: 1 });
    expect(totals.nodeCount).toBe(3);
  });
});

describe("formatDurationMs", () => {
  it("renders exact units and never invents a value for null", () => {
    expect(formatDurationMs(null)).toBe("unavailable");
    expect(formatDurationMs(850)).toBe("850ms");
    expect(formatDurationMs(60_000)).toBe("1m 00s");
    expect(formatDurationMs(61_400)).toBe("1m 01s");
    expect(formatDurationMs(125_000)).toBe("2m 05s");
  });
});
