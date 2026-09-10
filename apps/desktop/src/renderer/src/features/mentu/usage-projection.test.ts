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
      "Input tokens: 140 + 1 unknown",
    );
    expect(formatUsageTotal("Input tokens", { total: null, unknownCount: 2, invalidCount: 0 })).toBe(
      "Input tokens: unavailable",
    );
  });

  it("always spells out rejected values", () => {
    expect(formatUsageTotal("Output tokens", { total: 20, unknownCount: 0, invalidCount: 1 })).toBe(
      "Output tokens: 20 + 1 invalid",
    );
    expect(formatUsageTotal("Output tokens", { total: null, unknownCount: 1, invalidCount: 1 })).toBe(
      "Output tokens: unavailable + 1 invalid",
    );
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

  it("says why a rejected value is unavailable", () => {
    const value = formatStepUsageValue(
      step({
        usage: usage({ invalid: [{ field: "input_tokens", reason: "negative" }] }),
      }),
      "inputTokens",
    );
    expect(value).toBe("unavailable (negative)");
  });

  it("stays plainly unavailable with no evidence", () => {
    expect(formatStepUsageValue(step({}), "outputTokens")).toBe("unavailable");
  });
});
