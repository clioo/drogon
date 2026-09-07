import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "node:fs";
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
  projectSessionLiveness,
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

  it("reports the persisted session as a link, never as liveness", () => {
    const linked = projectBotRows([
      bot({
        currentSession: {
          sessionId: "session-stale",
          harness: "codex",
          model: null,
          startedAt: 1,
          rotatedAt: null,
        },
      }),
    ]);
    expect(linked[0].sessionLink).toBe("linked");
    expect(linked[0]).not.toHaveProperty("sessionActive");
    expect(projectBotRows([bot()])[0].sessionLink).toBe("none");
  });

  it("returns only caller-supplied liveness observations and never derives one from storage", () => {
    const storedSessionBot = bot({
      currentSession: {
        sessionId: "session-stale",
        harness: "codex",
        model: null,
        startedAt: 1,
        rotatedAt: null,
      },
    });
    expect(projectSessionLiveness("bot-1", undefined)).toBeNull();
    expect(projectSessionLiveness("bot-1", {})).toBeNull();
    expect(projectSessionLiveness("bot-1", { "bot-1": "live" })).toBe("live");
    expect(projectSessionLiveness("bot-1", { "bot-1": "unverifiable" })).toBe(
      "unverifiable",
    );
    expect(projectSessionLiveness("bot-1", { "bot-1": "exited" })).toBe(
      "exited",
    );
    expect(projectSessionLiveness("bot-other", { "bot-1": "live" })).toBeNull();
  });
});

describe("BotsPanel render", () => {
  it("renders the empty state without a create control until the service capability lands", () => {
    const markup = render(emptySnapshot);
    expect(markup).toContain("No Bots yet");
    expect(markup).not.toContain("Create Bot");
  });

  it("never renders a stored-but-stale session as live — link wording only, no liveness inference", () => {
    const markup = render({
      bots: [
        bot({
          currentSession: {
            sessionId: "session-stale",
            harness: "codex",
            model: null,
            startedAt: 1,
            rotatedAt: null,
          },
        }),
      ],
      history: [],
    });
    expect(markup).toContain("Session linked");
    expect(markup).not.toContain("session active");
    expect(markup).not.toContain("Observed liveness");
    expect(markup).not.toContain("live");
  });

  it("renders caller-supplied observed liveness verbatim and nothing when no observation exists", () => {
    const observed = {
      bots: [bot()],
      history: [],
    };
    const exited = render(observed, {
      observedLivenessByBotId: { "bot-1": "exited" },
    });
    expect(exited).toContain("Observed liveness: exited");
    const unverifiable = render(observed, {
      observedLivenessByBotId: { "bot-1": "unverifiable" },
    });
    expect(unverifiable).toContain("Observed liveness: unverifiable");
    const live = render(observed, {
      observedLivenessByBotId: { "bot-1": "live" },
    });
    expect(live).toContain("Observed liveness: live");
    const unobserved = render({
      bots: [
        bot({
          currentSession: {
            sessionId: "session-stale",
            harness: "codex",
            model: null,
            startedAt: 1,
            rotatedAt: null,
          },
        }),
      ],
      history: [],
    });
    expect(unobserved).not.toContain("Observed liveness");
    expect(unobserved).not.toContain("live");
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
    expect(markup).toContain("Responsibility history");
    expect(markup).toContain("Removed responsibility");
    expect(markup).toContain("Recorded");
    expect(markup).toContain("Review duty");
    expect(markup).toContain("Nightly review · run 3");
  });

  it("renders per-bot history rows as evidence detail, never as success status", () => {
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
    expect(markup).toContain("Responsibility history");
    expect(markup).toContain("Review duty");
    expect(markup).not.toContain("Completed");
    expect(markup).not.toContain("succeeded");
  });
});

describe("BotsPanel R2-S: create/chat gate on bridge+scope, same rule as the run button", () => {
  const scope = { hostId: "host-1", workspaceId: "ws-1", locale: "en-US" };
  const bridge = {
    botSnapshot: async () => ({
      ok: true as const,
      result: { ...scope, ...emptySnapshot },
    }),
    botCreate: async () => ({ ok: true as const, result: bot() }),
    botRun: async () => ({
      ok: true as const,
      result: {
        requestId: "r",
        hostId: scope.hostId,
        workspaceId: scope.workspaceId,
        automationRunId: null,
        responsibilityRunId: null,
        messageId: null,
        session: null,
        outcome: "dispatched" as const,
        refusal: null,
        reason: null,
        error: null,
        observedAt: null,
        recordedAt: 0,
      },
    }),
    botHistory: async () => ({
      ok: true as const,
      result: { ...scope, botId: "bot-1", messages: [] },
    }),
  };

  it("renders no Create Bot / Open session controls without both bridge and scope", () => {
    const markup = render({ bots: [bot()], history: [] });
    expect(markup).not.toContain("Create Bot");
    expect(markup).not.toContain('data-testid="open-session-bot-1"');
  });

  it("renders Create Bot on the empty state once bridge+scope are supplied", () => {
    const markup = render(emptySnapshot, { bridge, scope });
    expect(markup).toContain("Create Bot");
  });

  it("renders a per-bot Open session control once bridge+scope are supplied", () => {
    const markup = render({ bots: [bot()], history: [] }, { bridge, scope });
    expect(markup).toContain('data-testid="open-session-bot-1"');
    expect(markup).toContain("Open session");
  });

  it("still requires onRunResponsibility separately for the run button even with bridge+scope", () => {
    const markup = render(
      { bots: [bot({ responsibilities: [responsibility()] })], history: [] },
      { bridge, scope },
    );
    expect(markup).not.toContain("data-responsibility-id=");
  });

  it("exposes the bot list as role=list named Bots (Orca BotsPage parity)", () => {
    const markup = render({ bots: [bot()], history: [] }, { bridge, scope });
    expect(markup).toContain('role="list"');
    expect(markup).toContain('aria-label="Bots"');
  });

  it("labels the refresh control exactly Refresh Bots", () => {
    const markup = render(emptySnapshot, { bridge, scope });
    expect(markup).toContain('aria-label="Refresh Bots"');
  });

  it("keeps the Orca empty-state copy", () => {
    const markup = render(emptySnapshot, { bridge, scope });
    expect(markup).toContain("No Bots yet");
    expect(markup).toContain("Give a character a purpose.");
    expect(markup).toContain("Create Bot");
  });
});

describe("BotsPanel styling contract (admitted tokens/primitives only)", () => {
  it("styles the panel with the quiet monochrome token classes from main.css", () => {
    const markup = render({
      bots: [bot({ responsibilities: [responsibility()] })],
      history: [historyEntry()],
    });
    expect(markup).toContain('data-testid="bots-panel"');
    expect(markup).toMatch(/class="[^"]*flex h-full min-h-0 flex-col/);
    expect(markup).toContain("text-foreground");
    expect(markup).toContain("text-muted-foreground");
    expect(markup).toContain("border-border");
    expect(markup).toContain("rounded-md");
  });

  it("renders the manual run control through the admitted Button primitive", () => {
    const markup = render(
      { bots: [bot({ responsibilities: [responsibility()] })], history: [] },
      { onRunResponsibility: () => {} },
    );
    const runButtonStart = markup.lastIndexOf(
      "<button",
      markup.indexOf('data-bot-id="bot-1"'),
    );
    const runButtonEnd = markup.indexOf(
      ">",
      markup.indexOf('data-bot-id="bot-1"'),
    );
    const runButtonMarkup = markup.slice(runButtonStart, runButtonEnd + 1);
    expect(runButtonMarkup).toContain('data-slot="button"');
    expect(runButtonMarkup).toContain("size-8");
    expect(runButtonMarkup).toContain('data-bot-id="bot-1"');
    expect(runButtonMarkup).toContain('data-responsibility-id="resp-1"');
  });

  it("never hardcodes hex colors in the panel source — main.css variables are canonical", () => {
    for (const file of [
      "BotsPanel.tsx",
      "bots-panel-projection.ts",
      "BotResponsibilityCard.tsx",
      "BotsPageForms.tsx",
    ]) {
      const source = readFileSync(
        new URL(`./${file}`, import.meta.url),
        "utf8",
      );
      expect(source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    }
  });
});

describe("BotsPanel R7-E: header Back, add/delete responsibility controls", () => {
  const scope = { hostId: "host-1", workspaceId: "ws-1", locale: "en-US" };
  const fullBridge = {
    botSnapshot: async () => ({
      ok: true as const,
      result: { ...scope, ...emptySnapshot },
    }),
    botResponsibilityCreate: async () => ({
      ok: true as const,
      result: {
        ...scope,
        botId: "bot-1",
        responsibilityId: "resp-1",
        automationId: "auto-1",
      },
    }),
    botResponsibilityDelete: async () => ({
      ok: true as const,
      result: {
        ...scope,
        botId: "bot-1",
        responsibilityId: "resp-1",
        removed: true,
        automationId: "auto-1",
      },
    }),
  };

  it("renders the header Back button only when onClose is supplied", () => {
    const without = render({ bots: [bot()], history: [] });
    expect(without).not.toContain(">Back<");
    const withClose = render(
      { bots: [bot()], history: [] },
      { onClose: () => {} },
    );
    expect(withClose).toContain(">Back<");
  });

  it("renders Add/Delete responsibility controls only with both bridge methods and scope", () => {
    const gated = render(
      { bots: [bot({ responsibilities: [responsibility()] })], history: [] },
      { bridge: { botSnapshot: fullBridge.botSnapshot }, scope },
    );
    expect(gated).not.toContain("Add responsibility");
    expect(gated).not.toContain("Delete Review duty");
    const editable = render(
      { bots: [bot({ responsibilities: [responsibility()] })], history: [] },
      { bridge: fullBridge, scope },
    );
    expect(editable).toContain('data-testid="add-responsibility-bot-1"');
    expect(editable).toContain("Add responsibility");
    expect(editable).toContain('data-testid="delete-responsibility-resp-1"');
    expect(editable).toContain("Delete Review duty");
  });
});
