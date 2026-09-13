import { describe, expect, test } from "vitest";

import {
  DEFAULT_REPRO_RUNTIME,
  REPRO_RUNTIME_CHOICES,
  describeReproCost,
  describeWorkflowStatus,
  formatReproCost,
  isTerminalWorkflowStatus,
  priceReproUsage,
  REPRO_PHASES,
  REPRO_RATES,
  roundsOf,
  type ReproUsageEntry,
} from "./repro-demo-plan";

describe("the demo's plan", () => {
  test("walks nine phases, each named once", () => {
    const ids = REPRO_PHASES.map((phase) => phase.id);
    expect(ids).toEqual([
      "workspace",
      "seed",
      "bot",
      "policy",
      "watch",
      "spec",
      "firing",
      "rounds",
      "evidence",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("ships no model id of its own: the operator names the runtime", () => {
    // A demo that pinned a model would be choosing someone else's spend. Every
    // choice is a harness this product can run a node on, with the model left
    // to whatever that harness is already set up to use, or typed exactly.
    for (const choice of REPRO_RUNTIME_CHOICES) {
      expect(choice.model).toBe("");
      expect(choice.free).toBe(false);
    }
    expect(REPRO_RUNTIME_CHOICES.map((choice) => choice.harness)).toEqual([
      "claude",
      "codex",
      "opencode",
      "pi",
    ]);
    expect(DEFAULT_REPRO_RUNTIME).toBe(REPRO_RUNTIME_CHOICES[0]);
  });
});

describe("pricing what actually ran", () => {
  const demo = (extra: Partial<ReproUsageEntry> = {}): ReproUsageEntry => ({
    role: "main",
    harness: "opencode",
    model: "fixture/dog-tinder",
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    ...extra,
  });

  test("an empty ledger is not reported, never zero", () => {
    const cost = priceReproUsage([]);
    expect(cost.bucket).toBe("not_reported");
    expect(cost.totalUsd).toBeNull();
    expect(formatReproCost(cost)).toBe("unavailable");
    expect(describeReproCost(cost)).toMatch(/absence is not zero/);
  });

  test("prices every measurement at the demo rate and splits it by role", () => {
    const cost = priceReproUsage([
      demo(),
      demo({ role: "test", inputTokens: 500_000, outputTokens: 0 }),
    ]);
    // 1M in at $3 + 100k out at $15 = $4.50; 500k in at $3 = $1.50.
    expect(cost.bucket).toBe("exact");
    expect(cost.totalUsd).toBeCloseTo(6, 6);
    expect(cost.byRole).toEqual({ main: 4.5, test: 1.5 });
    expect(cost.inputTokens).toBe(1_500_000);
    expect(cost.outputTokens).toBe(100_000);
  });

  test("a model with no rate is unpriced, and says which one", () => {
    const cost = priceReproUsage([demo(), demo({ model: "some/unknown-model" })]);
    expect(cost.bucket).toBe("partial");
    expect(cost.pricedMeasurements).toBe(1);
    expect(cost.unpricedModels).toEqual(["opencode/some/unknown-model"]);
    expect(describeReproCost(cost)).toMatch(/no rate for/);
  });

  test("tokens with no rate at all are never priced as zero", () => {
    const cost = priceReproUsage([demo({ model: "some/unknown-model" })]);
    expect(cost.bucket).toBe("unpriced");
    expect(cost.totalUsd).toBeNull();
  });

  test("a model with a declared-free rate is named as free, not as an exact bill", () => {
    const cost = priceReproUsage(
      [demo({ harness: "pi", model: "some-local-model" })],
      {
        "some-local-model": {
          kind: "local_free",
          label: "local model, nothing billed",
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
      },
    );
    expect(cost.bucket).toBe("local_free");
    expect(cost.totalUsd).toBe(0);
    expect(describeReproCost(cost)).toMatch(/declared-free local model/);
  });

  test("a missing token field contributes nothing and stays unknown", () => {
    const cost = priceReproUsage([
      { role: "test", harness: "opencode", model: "fixture/dog-tinder" },
    ]);
    expect(cost.inputTokens).toBeNull();
    expect(cost.outputTokens).toBeNull();
    expect(cost.totalUsd).toBe(0);
  });
});

describe("the rounds the daemon reported", () => {
  test("reads steps verbatim, including a fallback attempt", () => {
    expect(
      roundsOf({
        steps: [
          {
            iteration: 1,
            phase: "test",
            status: "succeeded",
            verdict: "findings",
            isFallback: true,
            runtime: { harness: "pi", model: "qwen" },
          },
        ],
      }),
    ).toEqual([
      {
        iteration: 1,
        phase: "test",
        status: "succeeded",
        verdict: "findings",
        runtime: "pi/qwen",
        isFallback: true,
      },
    ]);
  });

  test("a run with no steps yet has no rounds", () => {
    expect(roundsOf(null)).toEqual([]);
    expect(roundsOf({})).toEqual([]);
  });

  test("unverifiable is terminal and is described as neither pass nor fail", () => {
    expect(isTerminalWorkflowStatus("unverifiable")).toBe(true);
    expect(isTerminalWorkflowStatus("running")).toBe(false);
    expect(describeWorkflowStatus("unverifiable")).toMatch(/nothing is assumed/);
    expect(describeWorkflowStatus("exhausted")).toMatch(/round cap/);
  });
});
