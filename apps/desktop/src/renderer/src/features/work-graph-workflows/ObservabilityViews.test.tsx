// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GraphObservabilitySnapshot } from "../../../../shared/graph-contract";
import { EvidenceView, UsageView } from "./ObservabilityViews";

afterEach(cleanup);

const snapshot: GraphObservabilitySnapshot = {
  updatedAt: "2026-09-12T12:00:00Z",
  evidence: [
    {
      id: "e1",
      timestamp: "2026-09-12T12:00:00Z",
      status: "progress",
      summary: "Unit tests pass",
      detail: "Validated the native ledger.",
      artifacts: ["reports/unit.txt"],
      agentId: "leader",
      role: "implementation",
    },
  ],
  usage: [
    {
      id: "u1",
      timestamp: "2026-09-12T12:00:00Z",
      agentId: "leader",
      role: "implementation",
      harness: "pi",
      model: "fixture",
      inputTokens: 120,
      outputTokens: 30,
    },
    {
      id: "u2",
      timestamp: "2026-09-12T12:01:00Z",
      agentId: "reviewer",
      role: "review",
      harness: "codex",
      outputTokens: 10,
    },
  ],
};

describe("native Work Graph observability views", () => {
  it("renders lead-agent checkpoints and artifact references", () => {
    render(<EvidenceView snapshot={snapshot} loading={false} />);
    expect(screen.getByText("Unit tests pass")).toBeTruthy();
    expect(screen.getByText("Validated the native ledger.")).toBeTruthy();
    expect(screen.getByText("reports/unit.txt")).toBeTruthy();
  });

  it("sums only reported usage and leaves missing fields unknown", () => {
    render(<UsageView snapshot={snapshot} loading={false} />);
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText("40")).toBeTruthy();
    expect(screen.getAllByText("Not reported")).toHaveLength(2);
    expect(screen.getByText(/2 measurements across 2 agents/)).toBeTruthy();
  });

  it("explains that evidence is a native .drogon file", () => {
    render(
      <EvidenceView
        snapshot={{ evidence: [], usage: [], updatedAt: "" }}
        loading={false}
      />,
    );
    expect(screen.getByText(".drogon/evidence.json")).toBeTruthy();
  });
});
