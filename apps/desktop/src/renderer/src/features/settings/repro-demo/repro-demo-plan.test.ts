import { describe, expect, test } from "vitest";

import {
  REPRO_SUPPORTED_HARNESSES,
  describeReproCost,
  describeWorkflowStatus,
  formatReproCost,
  harnessNeedsModel,
  isTerminalWorkflowStatus,
  pickDemoModel,
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

  test("ships no model id of its own: the harness's list names the runtime", () => {
    // A demo that pinned a model would be choosing someone else's spend. The
    // harnesses are the ones a Work Graph node can run on, and the model is
    // proposed from what the harness itself lists on this machine.
    expect([...REPRO_SUPPORTED_HARNESSES]).toEqual(["claude", "codex", "opencode", "pi"]);
    const option = (id: string, extra: Partial<{ verified: boolean; recommended: boolean }> = {}) => ({
      id,
      verified: false,
      recommended: false,
      ...extra,
    });
    // The host's recommendation wins, else the first id the host verified;
    // unverified (curated or typed) ids and the "harness default" row (an
    // empty id) are never proposed.
    expect(
      pickDemoModel([
        option(""),
        option("a", { verified: true }),
        option("b", { verified: true }),
        option("c", { verified: true, recommended: true }),
      ]),
    ).toBe("c");
    expect(pickDemoModel([option(""), option("a"), option("b", { verified: true })])).toBe("b");
    expect(pickDemoModel([option(""), option("a"), option("b")])).toBeNull();
    expect(pickDemoModel([option("", { verified: true })])).toBeNull();
    expect(pickDemoModel([])).toBeNull();
    // Shell adapters refuse a node without an exact id; native ones run their default.
    expect(harnessNeedsModel("pi")).toBe(true);
    expect(harnessNeedsModel("opencode")).toBe(true);
    expect(harnessNeedsModel("claude")).toBe(false);
    expect(harnessNeedsModel("codex")).toBe(false);
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
