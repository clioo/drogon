// MIT Copyright (c) 2026 Lovecast Inc.
// Contract tests for the `.drogon/graph.json` v1 parser: the ownership
// seam is parsed exactly as the coordinator's contract spells it, an
// unknown version refuses honestly, unknown evidence keys ride through
// (the view spells them out rather than dropping them), and a malformed
// file yields an honest refusal — never a thrown error or a half graph.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRAPH_POLICY,
  parseWorkGraphDocument,
  resolveGraphPolicy,
  stateNodeFor,
  WORK_GRAPH_VERSION,
  type WorkGraphDocument,
} from "./work-graph-contract";

function fixtureDocument(): WorkGraphDocument {
  return {
    version: 1,
    intent: {
      nodes: [
        {
          id: "n0",
          title: "Plan the work",
          harness: "pi",
          model: "qwen3.8-flash-next-nvidia-nvfp4",
          dependsOn: [],
          prompt: "Read the repo and plan.",
          enabled: true,
        },
        {
          id: "n1",
          title: "Run the migration",
          harness: "shell",
          model: "",
          dependsOn: ["n0"],
          prompt: "apply the migration",
          enabled: false,
        },
      ],
    },
    state: {
      updatedAt: "2026-09-11T12:00:00.000Z",
      nodes: [
        {
          id: "n0",
          status: "succeeded",
          runId: "run-123",
          startedAt: "2026-09-11T11:58:00.000Z",
          endedAt: "2026-09-11T11:59:30.000Z",
          evidence: {
            runId: "run-123",
            mentuRunId: "run_abc",
            step: {
              label: "n0",
              backend: "pi",
              status: "succeeded",
              exitCode: 0,
              durationSeconds: 90,
              outputPath: "/tmp/run-123/n0.out",
              usage: {
                inputTokens: 120,
                outputTokens: 45,
                usageKnown: true,
                invalid: [],
              },
            },
            drift: { expected: ["src/a.rs"], created: ["src/a.rs", "src/b.rs"] },
          },
        },
        { id: "n1", status: "unverifiable", lastError: "contact lost" },
      ],
    },
  };
}

describe("parseWorkGraphDocument", () => {
  it("parses the exact contract shape", () => {
    const parsed = parseWorkGraphDocument(JSON.stringify(fixtureDocument()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.version).toBe(WORK_GRAPH_VERSION);
    expect(parsed.document.intent.nodes).toHaveLength(2);
    expect(parsed.document.state.nodes).toHaveLength(2);
    // The daemon writes the EMPTY string for a shell node, never null.
    expect(parsed.document.intent.nodes[1].model).toBe("");
    expect(parsed.document.intent.nodes[1].enabled).toBe(false);
  });

  it("carries the intent's policy section through to the parsed document", () => {
    const document = fixtureDocument();
    (document.intent as { policy?: unknown }).policy = {
      approvedRuntimes: [{ harness: "opencode", model: "claude-sonnet-4" }],
      fallbackRuntime: null,
      adversarial: { enabled: true, maxIterations: 5 },
      delegate: true,
    };
    const parsed = parseWorkGraphDocument(JSON.stringify(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const policy = resolveGraphPolicy(parsed.document.intent);
    expect(policy.approvedRuntimes).toHaveLength(1);
    expect(policy.adversarial).toEqual({ enabled: true, maxIterations: 5 });
    expect(policy.delegate).toBe(true);
  });

  it("resolves the default policy when the document predates the field", () => {
    const parsed = parseWorkGraphDocument(JSON.stringify(fixtureDocument()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(resolveGraphPolicy(parsed.document.intent)).toEqual(DEFAULT_GRAPH_POLICY);
  });

  it("keeps a recorded measured zero as zero (usageKnown true)", () => {
    const document = fixtureDocument();
    document.state.nodes[0].evidence = {
      step: {
        label: "n0",
        backend: "pi",
        status: "succeeded",
        usage: { inputTokens: 0, outputTokens: 0, usageKnown: true, invalid: [] },
      },
    };
    const parsed = parseWorkGraphDocument(JSON.stringify(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const usage = parsed.document.state.nodes[0].evidence?.step?.usage;
    expect(usage).toMatchObject({ inputTokens: 0, outputTokens: 0, usageKnown: true });
  });

  it("preserves unknown evidence keys for display instead of dropping them", () => {
    const document = fixtureDocument();
    (document.state.nodes[0].evidence as Record<string, unknown>)["futureField"] = {
      nested: true,
    };
    const parsed = parseWorkGraphDocument(JSON.stringify(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.state.nodes[0].evidence?.["futureField"]).toEqual({
      nested: true,
    });
  });

  it("preserves unknown state-node keys (the halves evolve independently)", () => {
    const document = fixtureDocument();
    (document.state.nodes[1] as Record<string, unknown>)["attempt"] = 2;
    const parsed = parseWorkGraphDocument(JSON.stringify(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.state.nodes[1]["attempt"]).toBe(2);
  });

  it("refuses a future version honestly instead of guessing", () => {
    const document = { ...fixtureDocument(), version: 2 };
    const parsed = parseWorkGraphDocument(JSON.stringify(document));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failure.kind).toBe("unsupported_version");
    expect(parsed.failure.message).toContain("version 2");
  });

  it("refuses malformed JSON without throwing", () => {
    const parsed = parseWorkGraphDocument("{not json");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failure.kind).toBe("not_json");
  });

  it("refuses a document missing the state half (the seam is not optional)", () => {
    const parsed = parseWorkGraphDocument(
      JSON.stringify({ version: 1, intent: { nodes: [] } }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failure.kind).toBe("invalid");
  });

  it("refuses a state status the contract does not define", () => {
    const document = fixtureDocument();
    (document.state.nodes[1] as unknown as { status: string }).status = "kind-of-done";
    const parsed = parseWorkGraphDocument(JSON.stringify(document));
    expect(parsed.ok).toBe(false);
  });

  it("accepts every contract status, including unverifiable", () => {
    for (const status of [
      "idle",
      "running",
      "succeeded",
      "failed",
      "blocked",
      "unverifiable",
    ]) {
      const document = fixtureDocument();
      document.state.nodes[1].status = status as WorkGraphDocument["state"]["nodes"][number]["status"];
      expect(parseWorkGraphDocument(JSON.stringify(document)).ok).toBe(true);
    }
  });
});

describe("stateNodeFor", () => {
  it("returns the daemon's state entry for an intent node", () => {
    const parsed = parseWorkGraphDocument(JSON.stringify(fixtureDocument()));
    if (!parsed.ok) throw new Error("fixture must parse");
    expect(stateNodeFor(parsed.document, "n0")?.status).toBe("succeeded");
  });

  it("returns null when the daemon never observed the node", () => {
    const document = fixtureDocument();
    document.state.nodes = [];
    expect(stateNodeFor(document, "n0")).toBeNull();
  });
});
