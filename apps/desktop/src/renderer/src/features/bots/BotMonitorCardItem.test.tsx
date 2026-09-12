// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Card-level pins for the adversarial monitor fixes: a shipped
   `github_pr.v1` watch renders its repository (never "Unsupported rule
   kind"), a baseline seed renders as an informational notice (never a
   red error), an unknown kind stays fail-closed, and a parked watch
   carries the real approval affordance that names exactly what it
   arms. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BotMonitorCardItem } from "./BotMonitorCardItem";
import type { BotMonitorView } from "../../../../shared/bot-contract";

afterEach(cleanup);

function monitor(overrides: Partial<BotMonitorView> = {}): BotMonitorView {
  return {
    monitorId: "mon-1",
    version: 1,
    ruleKind: "local_file_digest.v1",
    projectId: "proj-1",
    enabled: true,
    approved: true,
    responsibilityId: null,
    cursor: "crc-1",
    lastEventId: null,
    health: "healthy",
    trigger: { kind: "scheduled", cron: "*/5 * * * *" },
    consecutiveErrors: 0,
    lastError: null,
    lastNotice: null,
    failureThreshold: 3,
    lastCheckAtMs: 1_000_000,
    lastCheckOutcome: "no_change",
    incidentCount: 0,
    delegationsToday: { used: 0, max: 10 },
    firing: null,
    resource: "notes/status.md",
    maxBytes: 65536,
    ...overrides,
  };
}

describe("BotMonitorCardItem", () => {
  it("renders a github_pr.v1 watch with its repository and case, never a bare rule kind", () => {
    render(
      <BotMonitorCardItem
        monitor={monitor({
          ruleKind: "github_pr.v1",
          resource: undefined,
          repo: "clioo/drogon",
          filter: "assigned",
          login: "clioo",
        })}
        responsibilityName="Review pull requests"
      />,
    );
    // The card is titled by the watched repository — the owner's headline
    // case — and the SOURCE cell names the case.
    expect(screen.getByText("clioo/drogon")).toBeTruthy();
    expect(
      screen.getByText("clioo/drogon · case: assigned (clioo)"),
    ).toBeTruthy();
    // The very build that ships the kind must never disown it.
    expect(screen.queryByText(/Unsupported rule kind/)).toBeNull();
    expect(screen.queryByText("github_pr.v1")).toBeNull();
  });

  it("renders a baseline seed as an informational notice, never a red error", () => {
    render(
      <BotMonitorCardItem
        monitor={monitor({
          ruleKind: "github_pr.v1",
          resource: undefined,
          repo: "clioo/drogon",
          filter: "opened",
          lastNotice: "baseline seeded; the backlog is never replayed",
        })}
      />,
    );
    const notice = screen.getByText(
      "baseline seeded; the backlog is never replayed",
    );
    expect(notice.className).toContain("text-muted-foreground");
    expect(notice.className).not.toContain("text-destructive");
    expect(screen.queryByText(/Last error/)).toBeNull();
    // A REAL error still renders red, exactly as before.
    cleanup();
    render(
      <BotMonitorCardItem
        monitor={monitor({
          lastNotice: null,
          lastError: "read failed",
          health: "failing",
        })}
      />,
    );
    const error = screen.getByText("Last error: read failed");
    expect(error.className).toContain("text-destructive");
  });

  it("keeps a genuinely unknown rule kind fail-closed", () => {
    render(
      <BotMonitorCardItem
        monitor={monitor({
          ruleKind: "future_kind.v9",
          resource: undefined,
          approved: false,
          health: "needs_approval",
        })}
      />,
    );
    expect(
      screen.getByText(
        "Unsupported rule kind — update Drogon to manage this monitor.",
      ),
    ).toBeTruthy();
    // No approval affordance can be offered for a kind this UI cannot
    // describe.
    expect(screen.queryByTestId("monitor-approval-mon-1")).toBeNull();
  });

  it("names the released case (pull/<n>) in the firing cell, never the bare rule kind", () => {
    render(
      <BotMonitorCardItem
        monitor={monitor({
          ruleKind: "github_pr.v1",
          resource: undefined,
          repo: "clioo/drogon",
          filter: "assigned",
          login: "clioo",
          firing: {
            lastEventId: "mev_1",
            lastOutcome: "dispatched",
            lastRunId: "run-1",
            lastDetail: null,
            lastResource: "pull/42",
            lastAtMs: 1_000_000,
            countToday: 1,
          },
        })}
        responsibilityName="Review pull requests"
        now={1_060_000}
      />,
    );
    // The firing names WHAT it released — the case — next to the
    // verdict: "Prompt sent · pull/42 · 1m ago".
    const cell = screen.getByText(/Prompt sent/);
    expect(cell.textContent).toContain("pull/42");
    expect(cell.textContent).toContain("1m ago");
    // A pre-version-3 evidence row (no resource recorded) still renders
    // the verdict honestly, with no fabricated case.
    cleanup();
    render(
      <BotMonitorCardItem
        monitor={monitor({
          firing: {
            lastEventId: "mev_2",
            lastOutcome: "dispatched",
            lastRunId: "run-2",
            lastDetail: null,
            lastResource: null,
            lastAtMs: 1_000_000,
            countToday: 1,
          },
        })}
        now={1_060_000}
      />,
    );
    const legacy = screen.getByText(/Prompt sent/);
    expect(legacy.textContent).toContain("Prompt sent · 1m ago");
  });

  it("offers a parked watch the real approval path and names what it arms", () => {
    const onApprove = vi.fn();
    render(
      <BotMonitorCardItem
        monitor={monitor({
          ruleKind: "github_pr.v1",
          resource: undefined,
          repo: "clioo/drogon",
          filter: "review_requested",
          login: "clioo",
          approved: false,
          health: "needs_approval",
          responsibilityId: "resp-1",
        })}
        responsibilityName="Review pull requests"
        botDisplayName="Watcher"
        onApprove={onApprove}
      />,
    );
    // The disclosure names exactly what approval arms: the repo, the
    // case, the bot and the responsibility it will dispatch.
    const disclosure = screen.getByTestId("monitor-approval-mon-1");
    expect(disclosure.textContent).toContain("clioo/drogon");
    expect(disclosure.textContent).toContain("review_requested");
    expect(disclosure.textContent).toContain("clioo");
    expect(disclosure.textContent).toContain("Watcher");
    expect(disclosure.textContent).toContain("Review pull requests");
    fireEvent.click(screen.getByTestId("monitor-approve-mon-1"));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});
