// MIT Copyright (c) 2026 Lovecast Inc.
// Contract tests for the Subagent policy section of `graph-contract.ts`:
// the zod shape mirrors `GraphPolicy`/`GraphRuntimeRef`/
// `GraphAdversarialPolicy` in `crates/drogon-protocol/src/graph.rs`
// exactly, an absent `policy` resolves to "nothing configured" rather than
// throwing, and the summary line is derived — never a separately tracked
// value that could drift from the policy it describes.

import { describe, expect, it } from "vitest";
import {
  ADVERSARIAL_OPTIONAL_SUBAGENT_COUNT,
  DEFAULT_ADVERSARIAL_MAX_ITERATIONS,
  DEFAULT_GRAPH_POLICY,
  MAX_ADVERSARIAL_MAX_ITERATIONS,
  MAX_POLICY_APPROVED_RUNTIMES,
  MIN_ADVERSARIAL_MAX_ITERATIONS,
  deriveSubagentPolicySummary,
  graphPolicySchema,
  graphResultSchema,
  graphWriteIntentPayloadSchema,
  resolveGraphPolicy,
  type GraphPolicy,
} from "./graph-contract";

function fixturePolicy(overrides: Partial<GraphPolicy> = {}): GraphPolicy {
  return {
    approvedRuntimes: [
      { harness: "opencode", model: "claude-sonnet-4" },
      { harness: "opencode", model: "gpt-5.3-codex" },
      { harness: "codex", model: "gpt-5.3-codex" },
    ],
    fallbackRuntime: { harness: "custom", model: "qwen3-coder" },
    adversarial: {
      enabled: false,
      maxIterations: DEFAULT_ADVERSARIAL_MAX_ITERATIONS,
    },
    delegate: false,
    ...overrides,
  };
}

describe("graphPolicySchema", () => {
  it("parses design-2's exact configuration", () => {
    const policy = graphPolicySchema.parse(
      fixturePolicy({
        adversarial: { enabled: true, maxIterations: 10 },
        delegate: true,
      }),
    );
    expect(policy.approvedRuntimes).toHaveLength(3);
    expect(policy.fallbackRuntime).toEqual({
      harness: "custom",
      model: "qwen3-coder",
    });
    expect(policy.adversarial).toEqual({ enabled: true, maxIterations: 10 });
    expect(policy.delegate).toBe(true);
  });

  it("defaults every field when parsing an empty object — nothing configured yet", () => {
    const policy = graphPolicySchema.parse({});
    expect(policy).toEqual(DEFAULT_GRAPH_POLICY);
  });

  it("rejects an out-of-range maxIterations in both directions", () => {
    expect(() =>
      graphPolicySchema.parse(
        fixturePolicy({
          adversarial: {
            enabled: true,
            maxIterations: MIN_ADVERSARIAL_MAX_ITERATIONS - 1,
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      graphPolicySchema.parse(
        fixturePolicy({
          adversarial: {
            enabled: true,
            maxIterations: MAX_ADVERSARIAL_MAX_ITERATIONS + 1,
          },
        }),
      ),
    ).toThrow();
  });

  it("rejects an unknown key instead of silently stripping it (strict)", () => {
    expect(() =>
      graphPolicySchema.parse({ ...fixturePolicy(), extraField: "nope" }),
    ).toThrow();
  });

  it("caps the approved-runtimes list", () => {
    const tooMany = Array.from(
      { length: MAX_POLICY_APPROVED_RUNTIMES + 1 },
      (_, i) => ({
        harness: "shell",
        model: `m${i}`,
      }),
    );
    expect(() =>
      graphPolicySchema.parse(fixturePolicy({ approvedRuntimes: tooMany })),
    ).toThrow();
  });
});

describe("resolveGraphPolicy", () => {
  it("falls back to the default when a daemon build omits policy entirely", () => {
    expect(resolveGraphPolicy({})).toEqual(DEFAULT_GRAPH_POLICY);
    expect(resolveGraphPolicy({ policy: undefined })).toEqual(
      DEFAULT_GRAPH_POLICY,
    );
  });

  it("returns the real policy when present", () => {
    const policy = fixturePolicy();
    expect(resolveGraphPolicy({ policy })).toBe(policy);
  });
});

describe("deriveSubagentPolicySummary", () => {
  it("matches design 1 exactly: adversarial off", () => {
    const policy = fixturePolicy({
      adversarial: { enabled: false, maxIterations: 3 },
    });
    expect(deriveSubagentPolicySummary(policy)).toBe(
      "3 approved · 1 fallback · 0 optional subagents",
    );
  });

  it("matches design 2 exactly: adversarial on", () => {
    const policy = fixturePolicy({
      adversarial: { enabled: true, maxIterations: 10 },
    });
    expect(deriveSubagentPolicySummary(policy)).toBe(
      "3 approved · 1 fallback · 2 optional subagents",
    );
  });

  it("is always derived from the policy, never a stored count that can drift", () => {
    const empty = deriveSubagentPolicySummary(DEFAULT_GRAPH_POLICY);
    expect(empty).toBe("0 approved · 0 fallback · 0 optional subagents");

    const noFallback = deriveSubagentPolicySummary(
      fixturePolicy({ fallbackRuntime: null }),
    );
    expect(noFallback).toBe("3 approved · 0 fallback · 0 optional subagents");
  });

  it("adds exactly the adversarial loop's two role nodes, never a delegate-driven count", () => {
    expect(ADVERSARIAL_OPTIONAL_SUBAGENT_COUNT).toBe(2);
    const delegateOnAdversarialOff = fixturePolicy({
      delegate: true,
      adversarial: { enabled: false, maxIterations: 3 },
    });
    expect(deriveSubagentPolicySummary(delegateOnAdversarialOff)).toBe(
      "3 approved · 1 fallback · 0 optional subagents",
    );
  });
});

describe("graphWriteIntentPayloadSchema", () => {
  it("accepts a payload with no policy at all (an intent-only node edit)", () => {
    const parsed = graphWriteIntentPayloadSchema.parse({ nodes: [] });
    expect(parsed.policy).toBeUndefined();
  });

  it("accepts a payload carrying both nodes and a full policy", () => {
    const parsed = graphWriteIntentPayloadSchema.parse({
      nodes: [],
      policy: fixturePolicy(),
    });
    expect(parsed.policy?.approvedRuntimes).toHaveLength(3);
  });

  it("still refuses a payload carrying `state`, policy or not", () => {
    expect(() =>
      graphWriteIntentPayloadSchema.parse({
        nodes: [],
        policy: fixturePolicy(),
        state: {},
      }),
    ).toThrow();
  });
});

describe("graphResultSchema", () => {
  it("parses a graph whose intent carries a policy section", () => {
    const parsed = graphResultSchema.parse({
      graph: {
        version: 1,
        intent: { nodes: [], policy: fixturePolicy() },
        state: { updatedAt: "", nodes: [] },
      },
    });
    expect(
      resolveGraphPolicy(parsed.graph.intent).approvedRuntimes,
    ).toHaveLength(3);
  });

  it("parses a graph from a daemon build that predates policy", () => {
    const parsed = graphResultSchema.parse({
      graph: {
        version: 1,
        intent: { nodes: [] },
        state: { updatedAt: "", nodes: [] },
      },
    });
    expect(resolveGraphPolicy(parsed.graph.intent)).toEqual(
      DEFAULT_GRAPH_POLICY,
    );
  });
});
