// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Behavior tests over a real `GraphPolicy` value: adding/reordering/
// removing an approved runtime, editing the fallback, toggling adversarial
// testing and its max-iterations stepper (bounded), toggling Delegate, and
// the derived summary line — every edit hands the parent a COMPLETE new
// policy, never a partial patch the parent could half-apply.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GraphPolicy } from "../../../../shared/graph-contract";
import type { Harness, Result } from "../../../../shared/session-contract";
import { SubagentPolicyPanel } from "./SubagentPolicyPanel";

// jsdom does not implement scrollIntoView; Radix Select calls it when a
// listbox actually opens (one test here opens the real fallback picker to
// prove the harness catalog loaded with real entries).
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const HARNESS_FIXTURE: Harness[] = [
  {
    harnessId: "opencode",
    displayName: "OpenCode",
    availability: "available",
    executable: "/fixture/opencode",
  },
  {
    harnessId: "codex",
    displayName: "Codex CLI",
    availability: "available",
    executable: "/fixture/codex",
  },
];

function ok<T>(result: T): Result<T> {
  return { ok: true, result };
}

function stubDrogon(): void {
  window.drogon = {
    harnesses: async () => ok({ hostId: "host", harnesses: HARNESS_FIXTURE }),
    harnessModels: async () =>
      ok({
        hostId: "host",
        catalog: {
          harness: "opencode",
          availability: "available",
          executable: "/fixture/opencode",
          provenance: {
            executable: "/fixture/opencode",
            argv: ["opencode", "--list-models"],
            version: "1.0.0",
            probedAtEpochMs: Date.now(),
            configScope: "user",
          },
          entries: [
            {
              provider: null,
              id: "claude-sonnet-4",
              context: null,
              maxOutput: null,
              thinking: null,
              images: null,
            },
          ],
          status: "enumerated" as const,
          note: null,
          retainedRoots: [],
        },
      }),
  } as unknown as typeof window.drogon;
}

function emptyPolicy(): GraphPolicy {
  return {
    approvedRuntimes: [],
    fallbackRuntime: null,
    adversarial: { enabled: false, maxIterations: 3 },
    delegate: false,
  };
}

function design2Policy(): GraphPolicy {
  return {
    approvedRuntimes: [
      { harness: "opencode", model: "claude-sonnet-4" },
      { harness: "opencode", model: "gpt-5.3-codex" },
      { harness: "codex", model: "gpt-5.3-codex" },
    ],
    fallbackRuntime: { harness: "codex", model: "qwen3-coder" },
    adversarial: { enabled: true, maxIterations: 10 },
    delegate: false,
  };
}

describe("SubagentPolicyPanel", () => {
  afterEach(cleanup);

  it("renders design-1's exact summary when nothing optional is enabled", () => {
    stubDrogon();
    render(
      <SubagentPolicyPanel
        policy={design2Policy()}
        interactive
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("subagent-policy-summary").textContent).toBe(
      "3 approved · 1 fallback · 2 optional subagents",
    );
  });

  it("renders the empty-policy summary honestly", () => {
    stubDrogon();
    render(
      <SubagentPolicyPanel
        policy={emptyPolicy()}
        interactive
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("subagent-policy-summary").textContent).toBe(
      "0 approved · 0 fallback · 0 optional subagents",
    );
  });

  it("adding an approved runtime hands the parent the whole policy with the new row appended", () => {
    stubDrogon();
    let latest: GraphPolicy | null = null;
    render(
      <SubagentPolicyPanel
        policy={emptyPolicy()}
        interactive
        onChange={(next) => {
          latest = next;
        }}
      />,
    );
    // The harness catalog loads asynchronously; a click that lands before it
    // resolves still appends a complete, valid row (the zero-cost default),
    // never an empty/invalid one.
    fireEvent.click(screen.getByTestId("add-approved-runtime"));
    expect(latest).not.toBeNull();
    expect(latest!.approvedRuntimes).toHaveLength(1);
    expect(latest!.approvedRuntimes[0].harness.length).toBeGreaterThan(0);
    expect(latest!.approvedRuntimes[0].model).toBe("");
  });

  it("once the real harness catalog loads, a new row defaults to its first entry", async () => {
    stubDrogon();
    let latest: GraphPolicy | null = null;
    render(
      <SubagentPolicyPanel
        policy={emptyPolicy()}
        interactive
        onChange={(next) => {
          latest = next;
        }}
      />,
    );
    // Opening the fallback picker's harness select is a real, user-visible
    // way to observe the catalog having loaded (it lists real entries, per
    // AGENTS.md's "never fabricate a menu"), without reaching into hook
    // internals.
    fireEvent.click(screen.getByTestId("fallback-runtime-harness"));
    await screen.findByText("OpenCode");
    fireEvent.keyDown(screen.getByTestId("fallback-runtime-harness"), {
      key: "Escape",
    });

    fireEvent.click(screen.getByTestId("add-approved-runtime"));
    expect(latest!.approvedRuntimes[0].harness).toBe("opencode");
  });

  it("moving an approved runtime down swaps its position, keeping the rest untouched", () => {
    stubDrogon();
    let latest: GraphPolicy | null = null;
    const policy = design2Policy();
    render(
      <SubagentPolicyPanel
        policy={policy}
        interactive
        onChange={(next) => {
          latest = next;
        }}
      />,
    );
    fireEvent.click(screen.getByTestId("approved-runtime-0-down"));
    expect(latest!.approvedRuntimes.map((r) => r.model)).toEqual([
      "gpt-5.3-codex",
      "claude-sonnet-4",
      "gpt-5.3-codex",
    ]);
  });

  it("the first row cannot move up and the last cannot move down", () => {
    stubDrogon();
    render(
      <SubagentPolicyPanel
        policy={design2Policy()}
        interactive
        onChange={() => {}}
      />,
    );
    expect(
      (screen.getByTestId("approved-runtime-0-up") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("approved-runtime-2-down") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("removing an approved runtime drops exactly that row", () => {
    stubDrogon();
    let latest: GraphPolicy | null = null;
    render(
      <SubagentPolicyPanel
        policy={design2Policy()}
        interactive
        onChange={(next) => {
          latest = next;
        }}
      />,
    );
    fireEvent.click(screen.getByTestId("approved-runtime-1-remove"));
    expect(latest!.approvedRuntimes.map((r) => r.model)).toEqual([
      "claude-sonnet-4",
      "gpt-5.3-codex",
    ]);
  });

  it("removing the fallback runtime clears it and the summary drops to 0 fallback (FRAGILE fix)", () => {
    stubDrogon();
    let policy = design2Policy();
    const handleChange = vi.fn((next: GraphPolicy) => {
      policy = next;
    });
    const { rerender } = render(
      <SubagentPolicyPanel policy={policy} interactive onChange={handleChange} />,
    );
    const remove = screen.getByTestId(
      "fallback-runtime-remove",
    ) as HTMLButtonElement;
    expect(remove.disabled).toBe(false);
    fireEvent.click(remove);
    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(policy.fallbackRuntime).toBeNull();
    rerender(<SubagentPolicyPanel policy={policy} interactive onChange={handleChange} />);
    expect(screen.getByTestId("subagent-policy-summary").textContent).toBe(
      "3 approved · 0 fallback · 2 optional subagents",
    );
    // Nothing left to remove: the control disables rather than no-oping.
    expect(
      (screen.getByTestId("fallback-runtime-remove") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("toggling adversarial testing on reveals the max-iterations stepper, bounded", () => {
    stubDrogon();
    let policy = emptyPolicy();
    const handleChange = vi.fn((next: GraphPolicy) => {
      policy = next;
    });
    const { rerender } = render(
      <SubagentPolicyPanel
        policy={policy}
        interactive
        onChange={handleChange}
      />,
    );
    expect(screen.queryByTestId("adversarial-max-iterations")).toBeNull();
    fireEvent.click(screen.getByTestId("adversarial-toggle"));
    expect(policy.adversarial.enabled).toBe(true);
    rerender(
      <SubagentPolicyPanel
        policy={policy}
        interactive
        onChange={handleChange}
      />,
    );
    expect(screen.getByTestId("adversarial-max-iterations")).toBeTruthy();
    expect(
      screen.getByTestId("adversarial-max-iterations-value").textContent,
    ).toBe("3");

    fireEvent.click(screen.getByTestId("adversarial-max-iterations-increase"));
    rerender(
      <SubagentPolicyPanel
        policy={policy}
        interactive
        onChange={handleChange}
      />,
    );
    expect(
      screen.getByTestId("adversarial-max-iterations-value").textContent,
    ).toBe("4");
  });

  it("the max-iterations stepper never exceeds the daemon's bounds", () => {
    stubDrogon();
    let policy: GraphPolicy = {
      ...emptyPolicy(),
      adversarial: { enabled: true, maxIterations: 10 },
    };
    const handleChange = vi.fn((next: GraphPolicy) => {
      policy = next;
    });
    const { rerender } = render(
      <SubagentPolicyPanel
        policy={policy}
        interactive
        onChange={handleChange}
      />,
    );
    expect(
      (
        screen.getByTestId(
          "adversarial-max-iterations-increase",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByTestId("adversarial-max-iterations-increase"));
    rerender(
      <SubagentPolicyPanel
        policy={policy}
        interactive
        onChange={handleChange}
      />,
    );
    expect(policy.adversarial.maxIterations).toBe(10);
  });

  it("toggling Delegate flips exactly that field", () => {
    stubDrogon();
    let latest: GraphPolicy | null = null;
    render(
      <SubagentPolicyPanel
        policy={emptyPolicy()}
        interactive
        onChange={(next) => {
          latest = next;
        }}
      />,
    );
    fireEvent.click(screen.getByTestId("delegate-toggle"));
    expect(latest!.delegate).toBe(true);
    expect(latest!.approvedRuntimes).toEqual([]);
  });

  it("disables every control and shows an honest reason when not interactive", () => {
    stubDrogon();
    render(
      <SubagentPolicyPanel
        policy={design2Policy()}
        interactive={false}
        onChange={() => {}}
      />,
    );
    expect(
      (screen.getByTestId("add-approved-runtime") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("adversarial-toggle") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("delegate-toggle") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "Save is unavailable",
    );
  });
});
