// @vitest-environment jsdom
/* Bot card dashboard expansion (Carlos directive on task_0436fdf3aa91):
   collapsed is the fork-verbatim surface; expanding reveals AUTOMATIONS
   (scheduled responsibilities with real scheduler status + last-run
   evidence from the mounted history, Run now over the existing handler)
   and MONITORS (honest empty — no service backing, so no rows and no dead
   actions). Zero invented rows: every automation row traces to a mounted
   responsibility, every last-run line to a mounted history entry. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BotResponsibilityCard } from "./BotResponsibilityCard";
import type {
  BotsPanelBot,
  BotsPanelHistoryEntry,
  BotsPanelResponsibility,
} from "./bots-panel-contracts";

afterEach(cleanup);

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
    characterPreset: "arya",
    displayIdentity: { displayName: "Watcher", handle: null, title: null },
    harnessPolicy: { defaultHarness: "pi", explicitModel: null },
    instructions: "Guard the realm.",
    memories: [],
    responsibilities: [responsibility()],
    currentSession: null,
    createdAt: 1,
    updatedAt: 1,
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

function mount(
  props: Partial<Parameters<typeof BotResponsibilityCard>[0]> = {},
) {
  const handlers = {
    onAddResponsibility: vi.fn(),
    onDelete: vi.fn(),
    onRunResponsibility: vi.fn(),
    onLaunch: vi.fn(),
  };
  render(
    <BotResponsibilityCard
      bot={bot()}
      history={[historyEntry()]}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("Bot card dashboard expansion", () => {
  it("stays collapsed by default with no dashboard sections", () => {
    mount();
    expect(
      screen.getByTestId("bot-details-bot-1").getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByTestId("bot-automations-bot-1")).toBeNull();
    expect(screen.queryByTestId("bot-monitors-bot-1")).toBeNull();
  });

  it("expands AUTOMATIONS from real responsibilities and history", () => {
    mount();
    fireEvent.click(screen.getByTestId("bot-details-bot-1"));
    const section = screen.getByTestId("bot-automations-bot-1");
    expect(section.textContent).toContain("Automations");
    expect(section.textContent).toContain("Nightly review");
    expect(section.textContent).toContain("Active");
    // Last-run evidence traces to the mounted history entry, never invented.
    expect(section.textContent).toContain("completed · run 3");
    expect(
      screen.getByRole("button", { name: "Run automation Nightly review" }),
    ).toBeTruthy();
  });

  it("marks disabled automations Paused and reports duties with no runs", () => {
    mount({
      bot: bot({
        responsibilities: [
          responsibility({ enabled: false }),
          responsibility({
            id: "resp-2",
            name: "Fresh duty",
            trigger: { kind: "scheduled", automationId: "auto-2" },
          }),
        ],
      }),
    });
    fireEvent.click(screen.getByTestId("bot-details-bot-1"));
    const section = screen.getByTestId("bot-automations-bot-1");
    expect(section.textContent).toContain("Paused");
    expect(section.textContent).toContain("No runs yet");
    expect(
      screen.getByRole("button", { name: "Run automation Nightly review" }),
    ).toHaveProperty("disabled", true);
  });

  it("runs an automation through the existing handler and adds over the existing form", () => {
    const handlers = mount();
    fireEvent.click(screen.getByTestId("bot-details-bot-1"));
    fireEvent.click(
      screen.getByRole("button", { name: "Run automation Nightly review" }),
    );
    expect(handlers.onRunResponsibility).toHaveBeenCalledWith("resp-1");
    fireEvent.click(screen.getByTestId("add-automation-bot-1"));
    expect(handlers.onAddResponsibility).toHaveBeenCalledTimes(1);
  });

  it("renders MONITORS as an honest empty with no dead actions", () => {
    mount({ bot: bot({ responsibilities: [] }) });
    fireEvent.click(screen.getByTestId("bot-details-bot-1"));
    const section = screen.getByTestId("bot-monitors-bot-1");
    expect(section.textContent).toContain("No monitors yet");
    expect(
      screen.getByTestId("bot-automations-bot-1").textContent,
    ).toContain("No automations yet");
    // No fake monitor actions exist anywhere in the expanded card.
    expect(
      screen.queryByRole("button", { name: /monitor/i }),
    ).toBeNull();
  });
});
