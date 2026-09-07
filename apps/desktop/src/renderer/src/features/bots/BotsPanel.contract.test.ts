import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { BotsPanel } from "./BotsPanel";
import type {
  BotsPanelBot,
  BotsPanelHistoryEntry,
  BotsPanelResponsibility,
  BotsPanelSnapshot,
} from "./bots-panel-contracts";
import {
  botDescription,
  modelLabel,
  projectBotRows,
  projectHistoryRows,
  projectResponsibilityRows,
  triggerLabel,
} from "./bots-panel-projection";

// Contract test for the exported-but-unmounted Bots panel (V4-B).
// Shapes mirror the admitted native Bot storage contracts
// (crates/drogon-core/src/bots/records.rs + automations/records.rs, camelCase
// serde JSON) — docs/migration/native-bot-state-contract.md. The panel reads
// caller-supplied props only: no store access, no RPC, no mounting here
// (V2 owns App mounting). Interactive click binding needs a DOM environment
// that this worktree does not provide; dispatch payloads are therefore pinned
// via the run button's data attributes.

function responsibility(
  overrides: Partial<BotsPanelResponsibility> = {},
): BotsPanelResponsibility {
  return {
    id: "resp-1",
    name: "Review duty",
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
    displayIdentity: { displayName: "Watcher", handle: null, title: null },
    harnessPolicy: { defaultHarness: "codex", explicitModel: null },
    instructions: "",
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
    responsibilityName: "Review duty",
    automationName: "Nightly review",
    automationRunNumber: 3,
    ...overrides,
  };
}

const emptySnapshot: BotsPanelSnapshot = { bots: [], history: [] };

function render(
  snapshot: BotsPanelSnapshot,
  props: Record<string, unknown> = {},
): string {
  return renderToStaticMarkup(createElement(BotsPanel, { snapshot, ...props }));
}

describe("BotsPanel projection", () => {
  it("falls back from title to instructions to the ready-for-purpose placeholder", () => {
    expect(
      botDescription(
        bot({
          displayIdentity: {
            displayName: "W",
            handle: null,
            title: "Reviewer",
          },
        }),
      ),
    ).toBe("Reviewer");
    expect(botDescription(bot({ instructions: "Review changes" }))).toBe(
      "Review changes",
    );
    expect(botDescription(bot())).toBe("Ready for a purpose");
  });

  it("keeps the model at the harness default unless an explicit model is stored", () => {
    expect(modelLabel(bot().harnessPolicy)).toBe("Harness default");
    expect(
      modelLabel({ defaultHarness: "codex", explicitModel: "gpt-5.5" }),
    ).toBe("gpt-5.5");
  });

  it("labels reactive and scheduled triggers without inventing schedule semantics", () => {
    expect(triggerLabel({ kind: "scheduled", automationId: "auto-7" })).toBe(
      "auto-7",
    );
    expect(
      triggerLabel({ kind: "reactive", event: "pull_request.opened" }),
    ).toBe("pull_request.opened");
    expect(triggerLabel({ kind: "reactive", event: null })).toBe(
      "connected event",
    );
  });

  it("sorts the bot list with locale-aware display-name ordering", () => {
    const rows = projectBotRows([
      bot({
        id: "b",
        displayIdentity: { displayName: "zeta", handle: null, title: null },
      }),
      bot({
        id: "a",
        displayIdentity: { displayName: "Alpha", handle: null, title: null },
      }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("permits a manual run only for enabled scheduled responsibilities", () => {
    const scheduled = projectResponsibilityRows(
      bot({
        responsibilities: [
          responsibility(),
          responsibility({
            id: "resp-off",
            name: "Paused duty",
            enabled: false,
            trigger: { kind: "scheduled", automationId: "auto-2" },
          }),
          responsibility({
            id: "resp-reactive",
            name: "Mention duty",
            kind: "reactive",
            trigger: { kind: "reactive", event: null },
          }),
        ],
      }),
    );
    expect(scheduled).toHaveLength(3);
    expect(scheduled[0]).toMatchObject({
      id: "resp-1",
      canManualRun: true,
      enabled: true,
    });
    expect(scheduled[1]).toMatchObject({
      id: "resp-off",
      canManualRun: false,
      enabled: false,
    });
    expect(scheduled[2]).toMatchObject({
      id: "resp-reactive",
      canManualRun: false,
    });
  });

  it("preserves storage history order and null joins instead of re-sorting or inventing links", () => {
    const orphaned = historyEntry({
      run: {
        id: "run-2",
        botId: "bot-1",
        responsibilityId: "resp-gone",
        automationId: null,
        automationRunId: null,
        startedAt: 900,
        endedAt: null,
        recipe: null,
        hostObservation: null,
      },
      responsibilityName: null,
      automationName: null,
      automationRunNumber: null,
    });
    const newestFirst = [orphaned, historyEntry()];
    const rows = projectHistoryRows(newestFirst);
    expect(rows.map((row) => row.runId)).toEqual(["run-2", "run-1"]);
    expect(rows[0]).toMatchObject({
      responsibilityName: null,
      automationName: null,
      automationRunNumber: null,
      hostObservation: null,
    });
  });
});

describe("BotsPanel render", () => {
  it("renders an actionable empty state", () => {
    const markup = render(emptySnapshot, { onCreateBot: () => {} });
    expect(markup).toContain("No Bots yet");
    expect(markup).toContain("Create Bot");
  });

  it("renders each bot card with description, model label and identity", () => {
    const markup = render({
      bots: [
        bot({
          instructions: "Guard the realm.",
          displayIdentity: {
            displayName: "Watcher",
            handle: "watcher",
            title: null,
          },
        }),
      ],
      history: [],
    });
    expect(markup).toContain("Watcher");
    expect(markup).toContain("Guard the realm.");
    expect(markup).toContain("Harness default");
    expect(markup).toContain("@watcher");
  });

  it("exposes the exact dispatch payload on scheduled run buttons and never on reactive ones", () => {
    const markup = render(
      {
        bots: [
          bot({
            responsibilities: [
              responsibility({ name: "Nightly review" }),
              responsibility({
                id: "resp-reactive",
                name: "Mention duty",
                kind: "reactive",
                trigger: { kind: "reactive", event: null },
              }),
            ],
          }),
        ],
        history: [],
      },
      { onRunResponsibility: () => {} },
    );
    expect(markup).toContain('data-bot-id="bot-1"');
    expect(markup).toContain('data-responsibility-id="resp-1"');
    expect(markup).toContain("Run Nightly review");
    expect(markup).not.toContain("Run Mention duty");
  });

  it("renders no run control when no dispatch callback is supplied", () => {
    const markup = render({
      bots: [bot({ responsibilities: [responsibility()] })],
      history: [],
    });
    expect(markup).not.toContain("data-bot-id=");
  });

  it("keeps orphaned history evidence visible with explicit null-join markers", () => {
    const markup = render({
      bots: [bot()],
      history: [
        historyEntry({
          run: {
            id: "run-2",
            botId: "bot-1",
            responsibilityId: "resp-gone",
            automationId: null,
            automationRunId: null,
            startedAt: 900,
            endedAt: null,
            recipe: null,
            hostObservation: null,
          },
          responsibilityName: null,
          automationName: null,
          automationRunNumber: null,
        }),
        historyEntry(),
      ],
    });
    expect(markup).toContain("run-2");
    expect(markup).toContain("unlinked responsibility");
    expect(markup).toContain("unlinked automation");
    expect(markup).toContain("run-1");
    expect(markup).toContain("Review duty");
  });

  it("shows host observations verbatim as evidence labels, never as success status", () => {
    const markup = render({
      bots: [bot()],
      history: [
        historyEntry({
          run: { ...historyEntry().run, id: "r-live", hostObservation: "live" },
        }),
        historyEntry({
          run: {
            ...historyEntry().run,
            id: "r-unv",
            hostObservation: "unverifiable",
          },
        }),
        historyEntry({
          run: { ...historyEntry().run, id: "r-none", hostObservation: null },
        }),
      ],
    });
    expect(markup).toContain("r-live");
    expect(markup).toContain("live");
    expect(markup).toContain("unverifiable");
    expect(markup).toContain("—");
  });
});
