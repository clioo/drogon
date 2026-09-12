/* MIT Copyright (c) 2026 Lovecast Inc.
   Expectations for the owner-design card (task_197f6a7eb370): collapsed
   row for an unconfigured bot, the expanded identity header with square
   avatar/handle chip/status pill, the HARNESS/MODEL POLICY/SESSION info
   tiles, the responsibilities chip row, the BOT WORKSPACE strip built from
   the real provisioned home, and the AUTOMATIONS/MONITORS columns whose
   rows come verbatim from the real scheduler records and
   `bot.monitor_list` — never invented sample values. */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { BotResponsibilityCard } from "./BotResponsibilityCard";
import type { AutomationSummary } from "../../../../shared/automation-contract";
import type { BotMonitorView } from "../../../../shared/bot-contract";
import type {
  BotsPanelBot,
  BotsPanelHistoryEntry,
  BotsPanelResponsibility,
} from "./bots-panel-contracts";

function responsibility(
  overrides: Partial<BotsPanelResponsibility> = {},
): BotsPanelResponsibility {
  return {
    id: "resp-1",
    name: "Nightly review",
    instructions: "Inspect the workspace.",
    kind: "scheduled",
    trigger: { kind: "scheduled", automationId: "auto-1" },
    enabled: true,
    recipe: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function bot(overrides: Partial<BotsPanelBot> = {}): BotsPanelBot {
  return {
    id: "bot-1",
    characterPreset: "none",
    displayIdentity: { displayName: "Watcher", handle: "watcher", title: null },
    harnessPolicy: { defaultHarness: "pi", explicitModel: null },
    instructions: "Guard the realm.",
    memories: [],
    responsibilities: [],
    currentSession: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function automation(
  overrides: Partial<AutomationSummary> = {},
): AutomationSummary {
  return {
    id: "auto-1",
    name: "Nightly review",
    cron: "0 2 * * *",
    workspaceId: null,
    harness: "pi",
    model: undefined,
    prompt: "Inspect the workspace.",
    enabled: true,
    nextRunAt: 2_000_000_000_000,
    lastRunAt: 1_000_000_000_000,
    lastRun: {
      id: "auto-run-1",
      status: "completed",
      trigger: "scheduled",
      scheduledFor: 1_000_000_000_000,
      error: null,
      exitCode: 0,
    },
    ...overrides,
  };
}

function monitor(
  overrides: Partial<BotMonitorView> = {},
): BotMonitorView {
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

function historyEntry(
  overrides: Partial<BotsPanelHistoryEntry> = {},
): BotsPanelHistoryEntry {
  return {
    run: {
      id: "run-1",
      botId: "bot-1",
      responsibilityId: "resp-1",
      automationId: "auto-1",
      automationRunId: "auto-run-1",
      startedAt: 200,
      endedAt: 300,
      recipe: null,
      hostObservation: "exited",
      invocation: "manual",
    },
    responsibilityName: "Nightly review",
    automationName: "Nightly review",
    automationRunNumber: 3,
    automationRunStatus: "completed",
    ...overrides,
  };
}

function render(
  props: Partial<Parameters<typeof BotResponsibilityCard>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(BotResponsibilityCard, {
      bot: bot(),
      history: [],
      automationsById: null,
      monitors: null,
      busy: false,
      expanded: true,
      onToggleExpanded: () => {},
      onAddResponsibility: () => {},
      onDelete: () => {},
      onRunResponsibility: () => {},
      onLaunch: () => {},
      onLaunchNew: () => {},
      ...props,
    }),
  );
}

describe("BotResponsibilityCard", () => {
  it("renders the collapsed row for a bot with nothing configured", () => {
    const markup = render({ expanded: false });
    expect(markup).toContain("Watcher");
    expect(markup).toContain("@watcher");
    expect(markup).toContain("Idle");
    expect(markup).toContain(
      "No automations or monitors yet",
    );
    // The standby claim requires the daemon to have actually provisioned
    // the bot's home — never claimed without it.
    expect(markup).not.toContain("Standby workspace initialized");
    // "+ Add" keeps the probe's accessible name so the create journey
    // stays one click deep.
    expect(markup).toContain('data-testid="add-responsibility-bot-1"');
    expect(markup).toContain('aria-label="Add responsibility"');
    expect(markup).toContain('data-testid="bot-expand-bot-1"');
    expect(markup).toContain('aria-expanded="false"');
    // The heavy body is not rendered.
    expect(markup).not.toContain("Model policy");
    expect(markup).not.toContain("Open session");
  });

  it("claims the standby workspace only when the home was provisioned", () => {
    const markup = render({
      expanded: false,
      bot: bot({
        home: { handle: "watcher", path: "/data/bots/watcher", homeWorkspaceId: "ws-home" },
      }),
    });
    expect(markup).toContain("Standby workspace initialized");
  });

  it("renders the expanded identity header with handle chip and status pill", () => {
    const markup = render();
    expect(markup).toContain("Watcher");
    expect(markup).toContain("@watcher");
    expect(markup).toContain("Guard the realm.");
    expect(markup).toContain('data-testid="bot-status-bot-1"');
    // Unconfigured bot, expanded: still the muted Idle verdict.
    expect(markup).toContain("Idle");
    expect(markup).toContain('aria-label="Watcher avatar"');
  });

  it("shows the design's green Ready for a purpose pill once configured", () => {
    const markup = render({ bot: bot({ responsibilities: [responsibility()] }) });
    expect(markup).toContain("Ready for a purpose");
  });

  it("reports an observed-live session as In session, never Idle", () => {
    const markup = render({
      bot: bot({ responsibilities: [responsibility()] }),
      observedLiveness: "live",
    });
    expect(markup).toContain("In session");
    // unverifiable makes no live claim either way.
    const unverifiable = render({
      bot: bot({ responsibilities: [responsibility()] }),
      observedLiveness: "unverifiable",
    });
    expect(unverifiable).not.toContain("In session");
  });

  it("renders initials in the avatar tile when the preset has no artwork", () => {
    const markup = render({
      bot: bot({
        characterPreset: "none",
        displayIdentity: {
          displayName: "Arya Stark",
          handle: "arya",
          title: null,
        },
      }),
    });
    expect(markup).toContain(">AS</span>");
    expect(markup).not.toContain("<img");
  });

  it("renders the harness/model/session info tiles with the real harness icon", () => {
    const markup = render();
    expect(markup).toContain("Harness");
    expect(markup).toContain("Pi");
    expect(markup).toContain("Model policy");
    expect(markup).toContain("Harness default");
    expect(markup).toContain("No session yet");
    const linked = render({
      bot: bot({
        currentSession: {
          sessionId: "s",
          harness: "pi",
          model: null,
          startedAt: 1,
          rotatedAt: null,
        },
      }),
    });
    expect(linked).toContain("Session linked");
  });

  it("renders the title/instructions description fallback chain", () => {
    expect(
      render({
        bot: bot({
          displayIdentity: {
            displayName: "Watcher",
            handle: null,
            title: "Reviewer",
          },
        }),
      }),
    ).toContain("Reviewer");
    expect(
      render({ bot: bot({ instructions: "" }) }),
    ).toContain("Ready for a purpose");
  });

  it("renders Open session and the trash delete unconditionally", () => {
    const markup = render();
    expect(markup).toContain('data-testid="open-session-bot-1"');
    expect(markup).toContain("Open session");
    expect(markup).toContain('data-testid="delete-bot-bot-1"');
    expect(markup).toContain('aria-label="Delete Watcher"');
    // The fork deletes immediately: no confirm dialog markup exists.
    expect(markup).not.toContain("bot-delete-confirm");
  });

  it("offers New session only when a session is recorded", () => {
    expect(render()).not.toContain('data-testid="new-session-bot-1"');
    expect(
      render({
        bot: bot({
          currentSession: {
            sessionId: "s",
            harness: "pi",
            model: null,
            startedAt: 1,
            rotatedAt: null,
          },
        }),
      }),
    ).toContain('data-testid="new-session-bot-1"');
  });

  it("renders the responsibilities chip row, with the run payload on the automation card", () => {
    const markup = render({
      bot: bot({ responsibilities: [responsibility()] }),
    });
    expect(markup).toContain("Responsibilities:");
    expect(markup).toContain("Nightly review");
    // Chips are labels; the run control lives once, on the automation
    // card (Playwright strict mode: exactly one `Run ${name}` per page).
    expect(markup).toContain('aria-label="Run Nightly review"');
    expect(markup).toContain('data-responsibility-id="resp-1"');
    expect(markup).toContain('data-bot-id="bot-1"');
    expect(markup).toContain('data-testid="add-responsibility-bot-1"');
  });

  it("renders reactive chips without a run control and with the adapter note", () => {
    const markup = render({
      bot: bot({
        responsibilities: [
          responsibility({
            id: "resp-r",
            name: "Mention duty",
            kind: "reactive",
            trigger: { kind: "reactive", event: "mention.created" },
          }),
        ],
      }),
    });
    expect(markup).toContain("Mention duty");
    expect(markup).toContain("Event adapter not connected");
    expect(markup).not.toContain("Run Mention duty");
  });

  it("renders the BOT WORKSPACE strip from the real provisioned home", () => {
    const without = render();
    expect(without).not.toContain("bot-workspace-bot-1");
    expect(without).not.toContain("Dedicated folder");
    const markup = render({
      bot: bot({
        home: {
          handle: "watcher",
          path: "/data/bots/watcher",
          homeWorkspaceId: "ws-home",
        },
      }),
    });
    expect(markup).toContain("Bot workspace");
    expect(markup).toContain("Dedicated folder · separate from project workspaces");
    expect(markup).toContain("/data/bots/watcher");
  });

  it("joins the automations column with the real scheduler record", () => {
    const markup = render({
      bot: bot({ responsibilities: [responsibility()] }),
      automationsById: new Map([["auto-1", automation()]]),
      history: [historyEntry()],
    });
    expect(markup).toContain('data-testid="bot-automations-bot-1"');
    expect(markup).toContain("Automations");
    expect(markup).toContain("1 active");
    expect(markup).toContain('data-testid="bot-automation-resp-1"');
    // Real schedule, harness/model, next/last run from the joined record.
    expect(markup).toContain("0 2 * * *");
    expect(markup).toContain("Harness &amp; model");
    expect(markup).toContain("Pi · default");
    expect(markup).toContain("Done");
    // The prompt renders quoted; the footer carries the real id.
    expect(markup).toContain("Inspect the workspace.");
    expect(markup).toContain("auto-1");
    // Run evidence lives inside the card as history-* rows.
    expect(markup).toContain("completed · run 3");
    expect(markup).toContain('data-testid="history-run-1"');
    expect(markup).toContain("1 run");
  });

  it("renders honest dashes when the automation record is missing", () => {
    const markup = render({
      bot: bot({ responsibilities: [responsibility()] }),
    });
    expect(markup).toContain('data-testid="bot-automation-resp-1"');
    expect(markup).toContain("No runs yet");
    // The id still resolves from the responsibility's own trigger.
    expect(markup).toContain("auto-1");
  });

  it("caps the automation card's history rows at three", () => {
    const markup = render({
      bot: bot({ responsibilities: [responsibility()] }),
      history: [1, 2, 3, 4].map((n) =>
        historyEntry({
          run: { ...historyEntry().run, id: `run-${n}` },
          automationRunNumber: n,
        }),
      ),
    });
    expect(markup).toContain("history-run-1");
    expect(markup).toContain("history-run-3");
    expect(markup).not.toContain("history-run-4");
  });

  it("renders the add-automation affordances", () => {
    const markup = render();
    expect(markup).toContain('data-testid="add-automation-bot-1"');
    expect(markup).toContain("Add an automation");
  });

  it("renders the monitors column from the durable monitor rows", () => {
    const markup = render({
      monitors: [monitor()],
    });
    expect(markup).toContain('data-testid="bot-monitors-bot-1"');
    expect(markup).toContain("1 watching");
    expect(markup).toContain('data-testid="bot-monitor-mon-1"');
    expect(markup).toContain("Watching");
    expect(markup).toContain("notes/status.md");
    expect(markup).toContain("*/5 * * * *");
    expect(markup).toContain("3 consecutive errors");
    expect(markup).toContain("mon-1");
    expect(markup).toContain("0/10 delegations today");
  });

  it("renders the monitor's last check from the real check evidence", () => {
    const checked = render({ monitors: [monitor()] });
    expect(checked).toContain("Healthy");
    expect(checked).not.toContain("No checks yet");
    const unchecked = render({
      monitors: [
        monitor({ lastCheckAtMs: null, lastCheckOutcome: null, cursor: null }),
      ],
    });
    expect(unchecked).toContain("No checks yet");
    const failing = render({
      monitors: [
        monitor({
          health: "failing",
          consecutiveErrors: 3,
          lastError: "read failed",
          lastNotice: null,
          lastCheckOutcome: "error",
        }),
      ],
    });
    expect(failing).toContain("Failing");
    expect(failing).toContain("Last error: read failed");
  });

  it("reports monitor incidents only when the store has them", () => {
    expect(render({ monitors: [monitor()] })).not.toContain("incident");
    expect(
      render({ monitors: [monitor({ incidentCount: 2 })] }),
    ).toContain("2 incidents recorded");
  });

  it("keeps an unknown rule kind visible but unmanageable", () => {
    const markup = render({
      monitors: [
        monitor({ ruleKind: "future_kind.v9", resource: undefined }),
      ],
    });
    expect(markup).toContain("future_kind.v9");
    expect(markup).toContain("Unsupported rule kind");
  });

  it("says so honestly when no monitor data source exists", () => {
    const markup = render({ monitors: null });
    expect(markup).toContain("Monitor details are unavailable");
    const empty = render({ monitors: [] });
    expect(empty).toContain("No monitors yet.");
  });

  it("renders the monitor's action and firing evidence from the durable rows", () => {
    // A bound monitor whose last event dispatched: the card names the
    // action by the bot's own responsibility name and shows the honest
    // "Prompt sent" verdict — the user can see the monitor acted.
    const fired = render({
      bot: bot({ responsibilities: [responsibility()] }),
      monitors: [
        monitor({
          responsibilityId: "resp-1",
          firing: {
            lastEventId: "mev_1",
            lastOutcome: "dispatched",
            lastRunId: "run-1",
            lastDetail: null,
            lastResource: null,
            lastAtMs: 1_000_000,
            countToday: 1,
          },
        }),
      ],
    });
    expect(fired).toContain("Dispatches Nightly review");
    expect(fired).toContain("Prompt sent ·");
    expect(fired).not.toContain("Never fired");
    // An unbound monitor says exactly what it does — observes only — and
    // never claims a firing that never happened.
    const observes = render({ monitors: [monitor()] });
    expect(observes).toContain("Observes only");
    expect(observes).toContain("Never fired");
    expect(observes).not.toContain("Dispatches");
    // A refusal keeps its real reason: the name resolves by id even when
    // the wording is adverse.
    const refused = render({
      bot: bot({ responsibilities: [responsibility()] }),
      monitors: [
        monitor({
          responsibilityId: "resp-1",
          firing: {
            lastEventId: "mev_2",
            lastOutcome: "refused",
            lastRunId: null,
            lastDetail: "bound responsibility is disabled",
            lastResource: null,
            lastAtMs: 1_000_000,
            countToday: 0,
          },
        }),
      ],
    });
    expect(refused).toContain("Refused ·");
    expect(refused).toContain("bound responsibility is disabled");
  });

  it("falls back to the responsibility id when the bot no longer carries the name", () => {
    const markup = render({
      bot: bot({ responsibilities: [] }),
      monitors: [
        monitor({
          responsibilityId: "resp-gone",
          firing: null,
        }),
      ],
    });
    expect(markup).toContain("Dispatches resp-gone");
  });
});
