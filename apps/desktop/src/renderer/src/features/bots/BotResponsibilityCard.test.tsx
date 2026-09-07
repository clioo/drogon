import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { BotResponsibilityCard } from "./BotResponsibilityCard";
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
    characterPreset: "arya",
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
    },
    responsibilityName: "Nightly review",
    automationName: "Nightly review",
    automationRunNumber: 3,
    ...overrides,
  };
}

function render(
  props: Parameters<typeof BotResponsibilityCard>[0],
): string {
  return renderToStaticMarkup(createElement(BotResponsibilityCard, props));
}

describe("BotResponsibilityCard", () => {
  it("renders the identity header with initials avatar, preset badge and handle", () => {
    const markup = render({ bot: bot(), history: [] });
    expect(markup).toContain("Watcher");
    expect(markup).toContain("arya");
    expect(markup).toContain("Guard the realm.");
    expect(markup).toContain("@watcher");
    // Initials avatar, never a character image.
    expect(markup).toContain("W");
    expect(markup).not.toContain("<img");
  });

  it("renders the harness/model/session grid with source copy", () => {
    const markup = render({ bot: bot(), history: [] });
    expect(markup).toContain("Harness");
    expect(markup).toContain("Pi");
    expect(markup).toContain("Model policy");
    expect(markup).toContain("Harness default");
    expect(markup).toContain("No session linked");
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
      history: [],
    });
    expect(linked).toContain("Session linked");
  });

  it("renders scheduled rows with trigger summary, Run payload and Delete", () => {
    const markup = render({
      bot: bot({ responsibilities: [responsibility()] }),
      history: [],
      onRunResponsibility: () => {},
      onDeleteResponsibility: () => {},
    });
    expect(markup).toContain("Nightly review");
    expect(markup).toContain("scheduled");
    expect(markup).toContain("auto-1");
    expect(markup).toContain('aria-label="Run Nightly review"');
    expect(markup).toContain('data-responsibility-id="resp-1"');
    expect(markup).toContain('aria-label="Delete Nightly review"');
  });

  it("renders reactive rows without a run control and with the adapter note", () => {
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
      history: [],
      onRunResponsibility: () => {},
      onDeleteResponsibility: () => {},
    });
    expect(markup).toContain("Mention duty");
    expect(markup).toContain("mention.created");
    expect(markup).toContain("Event adapter not connected");
    expect(markup).not.toContain("Run Mention duty");
  });

  it("renders no Run/Delete/Add controls without their callbacks", () => {
    const markup = render({
      bot: bot({ responsibilities: [responsibility()] }),
      history: [],
    });
    expect(markup).not.toContain("data-responsibility-id=");
    expect(markup).not.toContain("Add responsibility");
    expect(markup).not.toContain("Open session");
  });

  it("renders Open session only when its callback is supplied", () => {
    expect(
      render({ bot: bot(), history: [] }),
    ).not.toContain("Open session");
    expect(
      render({ bot: bot(), history: [], onOpenSession: () => {} }),
    ).toContain("Open session");
  });

  it("filters history per bot, caps at three rows and marks orphans", () => {
    const markup = render({
      bot: bot(),
      history: [
        historyEntry({ run: { ...historyEntry().run, id: "r1", botId: "other" } }),
        historyEntry({ run: { ...historyEntry().run, id: "r2" } }),
        historyEntry({ run: { ...historyEntry().run, id: "r3" } }),
        historyEntry({ run: { ...historyEntry().run, id: "r4" } }),
        historyEntry({ run: { ...historyEntry().run, id: "r5" } }),
        historyEntry({
          run: {
            ...historyEntry().run,
            id: "r6",
            automationRunId: null,
            automationId: null,
            recipe: null,
          },
          responsibilityName: null,
          automationName: null,
          automationRunNumber: null,
        }),
      ],
    });
    expect(markup).toContain("Responsibility history");
    expect(markup).toContain("Links to actual automation runs and Mentu evidence.");
    expect(markup).not.toContain("history-r1");
    expect(markup).toContain("history-r2");
    expect(markup).toContain("history-r4");
    // Fourth visible row is capped: only the first three render.
    expect(markup).not.toContain("history-r5");
    expect(markup).not.toContain("history-r6");
  });

  it("renders the Mentu-run and recorded fallbacks for unlinked rows", () => {
    const mentu = render({
      bot: bot(),
      history: [
        historyEntry({
          automationName: null,
          automationRunNumber: null,
          run: {
            ...historyEntry().run,
            recipe: { recipeRef: "triage", runId: "mentu-7", evidencePath: null },
          },
        }),
      ],
    });
    expect(mentu).toContain("Mentu run mentu-7");
    const recorded = render({
      bot: bot(),
      history: [
        historyEntry({
          responsibilityName: null,
          automationName: null,
          automationRunNumber: null,
          run: { ...historyEntry().run, recipe: null },
        }),
      ],
    });
    expect(recorded).toContain("Removed responsibility");
    expect(recorded).toContain("Recorded");
  });

  it("renders no history section without rows", () => {
    expect(render({ bot: bot(), history: [] })).not.toContain(
      "Responsibility history",
    );
  });
});
