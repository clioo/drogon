// Projection tests for the observed usage renderer port: totals sum each
// recorded attempt entry exactly once, unreported values stay unknown,
// rejected values are visibly marked, and re-projecting the same run is
// stable.

import { describe, expect, it } from "vitest";
import type { MentuStepRun, MentuStepUsage } from "../../../../shared/mentu-contract";
import {
  formatStepUsageValue,
  formatUsageTotal,
  projectUsage,
  runHasAgentSteps,
  usageCardKind,
  usageExact,
} from "./usage-projection";

function usage(overrides: Partial<MentuStepUsage> = {}): MentuStepUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    usageKnown: null,
    invalid: [],
    ...overrides,
  };
}

function step(overrides: Partial<MentuStepRun> = {}): MentuStepRun {
  return {
    label: "build",
    backend: "pi",
    status: "succeeded",
    exitCode: 0,
    durationSeconds: 1,
    attempts: 1,
    outputPath: null,
    errorPath: null,
    error: null,
    verification: null,
    ...overrides,
  };
}

describe("projectUsage", () => {
  it("sums each recorded attempt once without a run-level double count", () => {
    const steps = [
      step({
        label: "recover",
        attempts: 1,
        usage: usage({ inputTokens: 100, outputTokens: 50 }),
      }),
      step({
        label: "recover",
        attempts: 2,
        usage: usage({ inputTokens: 40 }),
      }),
    ];
    const projection = projectUsage(steps);
    expect(projection.input).toEqual({ total: 140, unknownCount: 0, invalidCount: 0 });
    expect(projection.output).toEqual({ total: 50, unknownCount: 1, invalidCount: 0 });
    // Idempotent: re-projecting the same entries never grows totals.
    expect(projectUsage(steps)).toEqual(projection);
  });

  it("counts entries without a usage object as unknown, never zero", () => {
    const projection = projectUsage([step({}), step({})]);
    expect(projection.input).toEqual({ total: null, unknownCount: 2, invalidCount: 0 });
    expect(projection.output).toEqual({ total: null, unknownCount: 2, invalidCount: 0 });
  });

  it("keeps a measured zero exact and an unreported zero unknown", () => {
    const measured = projectUsage([
      step({ usage: usage({ inputTokens: 0, outputTokens: 5, usageKnown: true }) }),
    ]);
    expect(measured.input.total).toBe(0);
    expect(usageExact(measured.input)).toBe(true);
    const unreported = projectUsage([
      step({ usage: usage({ inputTokens: null, outputTokens: 5 }) }),
    ]);
    expect(unreported.input.total).toBeNull();
    expect(usageExact(unreported.input)).toBe(false);
  });

  it("marks invalid values per field without summing them", () => {
    const projection = projectUsage([
      step({
        usage: usage({
          invalid: [
            { field: "input_tokens", reason: "negative" },
            { field: "output_tokens", reason: "not_a_number" },
          ],
        }),
      }),
      step({ usage: usage({ inputTokens: 10, outputTokens: 20 }) }),
    ]);
    expect(projection.input).toEqual({ total: 10, unknownCount: 1, invalidCount: 1 });
    expect(projection.output).toEqual({ total: 20, unknownCount: 1, invalidCount: 1 });
  });
});

describe("formatUsageTotal", () => {
  it("matches the fork's unknown suffix only alongside a total", () => {
    expect(formatUsageTotal("Input tokens", { total: 140, unknownCount: 1, invalidCount: 0 })).toBe(
      "Input tokens: 140 + 1 not reported",
    );
    expect(formatUsageTotal("Input tokens", { total: null, unknownCount: 2, invalidCount: 0 })).toBe(
      "Input tokens: not reported",
    );
  });

  it("always spells out rejected values", () => {
    expect(formatUsageTotal("Output tokens", { total: 20, unknownCount: 0, invalidCount: 1 })).toBe(
      "Output tokens: 20 + 1 failed to parse",
    );
    expect(formatUsageTotal("Output tokens", { total: null, unknownCount: 1, invalidCount: 1 })).toBe(
      "Output tokens: not reported + 1 failed to parse",
    );
  });

  it("says not applicable for a field that cannot exist (shell-only run)", () => {
    expect(
      formatUsageTotal("Input tokens", { total: null, unknownCount: 1, invalidCount: 0 }, "not_applicable"),
    ).toBe("Input tokens: not applicable");
  });

  it("classifies the four honest card states", () => {
    const shell = [step({ backend: "shell" })];
    expect(runHasAgentSteps(shell)).toBe(false);
    expect(
      usageCardKind({ total: null, unknownCount: 1, invalidCount: 0 }, false),
    ).toBe("not_applicable");
    expect(
      usageCardKind({ total: null, unknownCount: 1, invalidCount: 0 }, true),
    ).toBe("not_reported");
    expect(
      usageCardKind({ total: null, unknownCount: 0, invalidCount: 1 }, true),
    ).toBe("failed_to_parse");
    expect(
      usageCardKind({ total: 5, unknownCount: 0, invalidCount: 0 }, true),
    ).toBe("exact");
  });
});

describe("formatStepUsageValue", () => {
  it("labels measured values exact", () => {
    const value = formatStepUsageValue(
      step({ usage: usage({ inputTokens: 1234 }) }),
      "inputTokens",
    );
    expect(value).toBe("1,234 (exact)");
  });

  it("says a rejected value failed to parse and why", () => {
    const value = formatStepUsageValue(
      step({
        usage: usage({ invalid: [{ field: "input_tokens", reason: "negative" }] }),
      }),
      "inputTokens",
    );
    expect(value).toBe("failed to parse (negative)");
  });

  it("says not reported when an agent step has no evidence", () => {
    expect(formatStepUsageValue(step({}), "outputTokens")).toBe("not reported");
  });

  it("says not applicable for a shell step", () => {
    expect(
      formatStepUsageValue(step({ backend: "shell", usage: undefined }), "outputTokens"),
    ).toBe("not applicable");
  });
});
