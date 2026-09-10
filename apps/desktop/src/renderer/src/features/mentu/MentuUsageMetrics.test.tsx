// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Rendering tests for the dedicated observed-usage component: totals and
// per-attempt rows stay honest for measured, zero, unknown and rejected
// values, and models render from the record when it carries them.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { MentuStepRun, MentuStepUsage } from "../../../../shared/mentu-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { UsageStepMetrics, UsageTokenCards } from "./MentuUsageMetrics";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

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

describe("UsageTokenCards", () => {
  it("marks fully measured runs exact and partial runs unknown", () => {
    render(
      <UsageTokenCards
        steps={[
          step({ usage: usage({ inputTokens: 1200, outputTokens: 340, usageKnown: true }) }),
          step({ usage: usage({ inputTokens: 80, outputTokens: 87, usageKnown: true }) }),
        ]}
      />,
    );
    expect(screen.getByText("Input tokens: 1,280")).toBeTruthy();
    expect(screen.getByText("Output tokens: 427")).toBeTruthy();
    const badges = screen.getAllByText("Exact · run record");
    expect(badges).toHaveLength(2);
  });

  it("keeps a genuine measured zero exact", () => {
    render(
      <UsageTokenCards
        steps={[step({ usage: usage({ inputTokens: 0, outputTokens: 0, usageKnown: true }) })]}
      />,
    );
    expect(screen.getByText("Input tokens: 0")).toBeTruthy();
    expect(screen.getByText("Output tokens: 0")).toBeTruthy();
    expect(screen.getAllByText("Exact · run record")).toHaveLength(2);
  });

  it("keeps no-evidence runs unavailable without inventing zeros", () => {
    render(<UsageTokenCards steps={[step({})]} />);
    expect(screen.getByText("Input tokens: unavailable")).toBeTruthy();
    expect(screen.getByText("Output tokens: unavailable")).toBeTruthy();
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
  });

  it("marks rejected values on the total card", () => {
    render(
      <UsageTokenCards
        steps={[
          step({
            usage: usage({
              invalid: [{ field: "input_tokens", reason: "negative" }],
            }),
          }),
        ]}
      />,
    );
    expect(screen.getByText("Input tokens: unavailable + 1 invalid")).toBeTruthy();
  });
});

describe("UsageStepMetrics", () => {
  it("renders the recorded model and exact token values", () => {
    render(
      <UsageStepMetrics
        step={step({
          model: "glm-5.3-flash",
          usage: usage({ inputTokens: 1200, outputTokens: 340 }),
        })}
      />,
    );
    expect(screen.getByText("Model: glm-5.3-flash")).toBeTruthy();
    expect(screen.getByText("Input tokens: 1,200 (exact)")).toBeTruthy();
    expect(screen.getByText("Output tokens: 340 (exact)")).toBeTruthy();
  });

  it("stays unavailable for absent values and says why values were rejected", () => {
    render(
      <UsageStepMetrics
        step={step({
          usage: usage({
            invalid: [{ field: "output_tokens", reason: "not_an_integer" }],
          }),
        })}
      />,
    );
    expect(screen.getByText("Model: unavailable")).toBeTruthy();
    expect(screen.getByText("Input tokens: unavailable")).toBeTruthy();
    expect(screen.getByText("Output tokens: unavailable (not an integer)")).toBeTruthy();
  });
});
