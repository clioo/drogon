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

  it("keeps no-evidence runs not reported without inventing zeros", () => {
    render(<UsageTokenCards steps={[step({})]} />);
    expect(screen.getByText("Input tokens: not reported")).toBeTruthy();
    expect(screen.getByText("Output tokens: not reported")).toBeTruthy();
    expect(screen.getAllByText("Not reported")).toHaveLength(2);
  });

  it("reads a shell-only run as not applicable, not unavailable", () => {
    render(
      <UsageTokenCards
        steps={[
          step({ label: "one", backend: "shell", usage: undefined }),
          step({ label: "two", backend: "shell", usage: undefined }),
        ]}
      />,
    );
    expect(screen.getByText("Input tokens: not applicable")).toBeTruthy();
    expect(screen.getByText("Output tokens: not applicable")).toBeTruthy();
    expect(screen.getAllByText("Not applicable")).toHaveLength(2);
    expect(screen.queryByText("Unavailable")).toBeNull();
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
    expect(screen.getByText("Input tokens: not reported + 1 failed to parse")).toBeTruthy();
    expect(screen.getByText("Failed to parse")).toBeTruthy();
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

  it("distinguishes not reported, failed to parse and shell not applicable", () => {
    render(
      <UsageStepMetrics
        step={step({
          usage: usage({
            invalid: [{ field: "output_tokens", reason: "not_an_integer" }],
          }),
        })}
      />,
    );
    expect(screen.getByText("Model: not reported")).toBeTruthy();
    expect(screen.getByText("Input tokens: not reported")).toBeTruthy();
    expect(screen.getByText("Output tokens: failed to parse (not an integer)")).toBeTruthy();
  });

  it("reads a shell step's token fields as not applicable", () => {
    render(<UsageStepMetrics step={step({ backend: "shell", usage: undefined })} />);
    expect(screen.getByText("Model: not applicable")).toBeTruthy();
    expect(screen.getByText("Input tokens: not applicable")).toBeTruthy();
    expect(screen.getByText("Output tokens: not applicable")).toBeTruthy();
  });
});
