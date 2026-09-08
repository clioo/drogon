/* MIT Copyright (c) 2026 Lovecast Inc. Ported expectations from Orca's
   bots component tests onto the fork-verbatim card (R17-E #348): character
   artwork avatar, immediate header Delete (no confirm), unconditional
   Open session/Add responsibility controls, fork responsibility-row and
   history-row composition, and the "No session yet" copy. */

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
      invocation: "manual",
    },
    responsibilityName: "Nightly review",
    automationName: "Nightly review",
    automationRunNumber: 3,
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
      onAddResponsibility: () => {},
      onDelete: () => {},
      onRunResponsibility: () => {},
      onLaunch: () => {},
      ...props,
    }),
  );
}

describe("BotResponsibilityCard", () => {
  it("renders the identity header with the character artwork avatar, preset badge and handle", () => {
    const markup = render();
    expect(markup).toContain("Watcher");
    expect(markup).toContain("arya");
    expect(markup).toContain("Guard the realm.");
    expect(markup).toContain("@watcher");
    // The fork's artwork branch: a known preset renders its <img> avatar.
    expect(markup).toContain("<img");
    expect(markup).toContain('aria-label="Watcher avatar"');
  });

  it("renders the source's Bot glyph fallback for the none preset", () => {
    const markup = render({ bot: bot({ characterPreset: "none" }) });
    expect(markup).not.toContain("<img");
    expect(markup).toContain('aria-label="Watcher avatar"');
  });

  it("renders the harness/model/session grid with source copy", () => {
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

  it("renders the source's title/instructions description fallback", () => {
    expect(
      render({
        bot: bot({
          displayIdentity: {
            displayName: "Watcher",
            handle: null,
            title: "Reviewer",
          },
          instructions: "Guard the realm.",
        }),
      }),
    ).toContain("Reviewer");
    expect(render({ bot: bot({ instructions: "" }) })).toContain(
      "Ready for a purpose",
    );
  });

  it("renders scheduled rows with the Run payload and no invented controls", () => {
    const markup = render({
      bot: bot({ responsibilities: [responsibility()] }),
    });
    expect(markup).toContain("Nightly review");
    expect(markup).toContain("scheduled");
    expect(markup).toContain('aria-label="Run Nightly review"');
    expect(markup).toContain('data-responsibility-id="resp-1"');
    // Fork parity (#348): no per-row Delete and no mono trigger summary.
    expect(markup).not.toContain('aria-label="Delete Nightly review"');
    expect(markup).not.toContain("font-mono");
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
    });
    expect(markup).toContain("Mention duty");
    expect(markup).toContain("Event adapter not connected");
    expect(markup).not.toContain("Run Mention duty");
  });

  it("renders Open session and Delete unconditionally, like the source", () => {
    const markup = render();
    expect(markup).toContain('data-testid="open-session-bot-1"');
    expect(markup).toContain("Open session");
    expect(markup).toContain('data-testid="delete-bot-bot-1"');
    // The source deletes immediately: no confirm dialog markup exists.
    expect(markup).not.toContain("bot-delete-confirm");
    expect(markup).not.toContain("Delete &ldquo;Watcher&rdquo;?");
  });

  it("always renders Add responsibility", () => {
    const markup = render();
    expect(markup).toContain('data-testid="add-responsibility-bot-1"');
    expect(markup).toContain("Add responsibility");
  });

  it("filters history per bot, caps at three rows and marks orphans", () => {
    const markup = render({
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

  it("renders history rows as the source does: name plus evidence line, no invocation badge, no observation suffix", () => {
    const markup = render({
      history: [
        historyEntry({
          run: { ...historyEntry().run, id: "done", hostObservation: "exited" },
        }),
        historyEntry({
          run: { ...historyEntry().run, id: "sched", invocation: "scheduled" },
        }),
      ],
    });
    expect(markup).toContain("Nightly review · run 3");
    // The fork's evidence line carries no status verdict and no invocation
    // badge — invented UI is not rendered.
    expect(markup).not.toContain("· exited");
    expect(markup).not.toContain(">Scheduled<");
    expect(markup).not.toContain(">Manual<");
    expect(markup).not.toContain("Completed");
    expect(markup).not.toContain("succeeded");
  });

  it("renders no history section without rows", () => {
    expect(render()).not.toContain("Responsibility history");
  });
});
