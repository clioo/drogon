// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/BotsPage.test.tsx (adapters: this repo's
   page loads its snapshot through the caller and mutates through the gated
   bot bridge, so the page-level cases are ported here against BotsPanel
   with a fake bridge — run-a-responsibility-through-the-owning-card,
   recoverable error with retry, create reloads the list, failed mutations
   surface alerts, Escape closes forms before the page — over the same
   bots-page-model/controller semantics the source tests pin). */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { BotsPanel } from "./BotsPanel";
import type {
  BotsPanelBot,
  BotsPanelResponsibility,
} from "./bots-panel-contracts";

afterEach(cleanup);

const scope = { hostId: "host-1", workspaceId: "ws-1", locale: "en-US" };

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

/** Fake bridge over a mutable bot list: mutations edit the list and every
 *  snapshot call is counted, so tests pin the reload-after-mutation
 *  contract without touching the daemon. */
function fakeBridge(initial: BotsPanelBot[]) {
  const bots = [...initial];
  let snapshots = 0;
  let failNext: string | null = null;
  const bridge = {
    botSnapshot: async () => {
      snapshots += 1;
      if (failNext) {
        const message = failNext;
        failNext = null;
        throw new Error(message);
      }
      return {
        ok: true as const,
        result: { ...scope, bots: [...bots], history: [] },
      };
    },
    botCreate: async (input: {
      body: {
        characterPreset: string;
        displayIdentity: {
          displayName: string;
          handle: string | null;
          title: string | null;
        };
      };
    }) => {
      const created = bot({
        id: "bot-new",
        characterPreset: input.body.characterPreset,
        displayIdentity: {
          displayName: input.body.displayIdentity.displayName,
          handle: input.body.displayIdentity.handle,
          title: input.body.displayIdentity.title,
        },
      });
      bots.push(created);
      return { ok: true as const, result: created };
    },
    botResponsibilityCreate: async () => ({
      ok: true as const,
      result: {
        ...scope,
        botId: "bot-1",
        responsibilityId: "resp-new",
        automationId: "auto-new",
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
    botDelete: async () => {
      const index = bots.findIndex((entry) => entry.id === "bot-1");
      if (index >= 0) bots.splice(index, 1);
      return {
        ok: true as const,
        result: { ...scope, botId: "bot-1", removed: true, automationIds: [] },
      };
    },
  };
  return {
    bridge,
    snapshots: () => snapshots,
    failNextSnapshotWith: (message: string) => {
      failNext = message;
    },
  };
}

describe("use-bots-page-controller", () => {
  it("runs a responsibility through the Bot card that owns it", async () => {
    const onRunResponsibility = vi.fn();
    render(
      <BotsPanel
        snapshot={{
          bots: [
            bot({
              id: "bot-1",
              displayIdentity: {
                displayName: "First Bot",
                handle: null,
                title: null,
              },
              responsibilities: [responsibility({ name: "First duty" })],
            }),
            bot({
              id: "bot-2",
              displayIdentity: {
                displayName: "Second Bot",
                handle: null,
                title: null,
              },
              responsibilities: [
                responsibility({
                  id: "bot-2-responsibility",
                  name: "Second duty",
                }),
              ],
            }),
          ],
          history: [],
        }}
        onRunResponsibility={onRunResponsibility}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Run Second duty" }),
    );
    await waitFor(() =>
      expect(onRunResponsibility).toHaveBeenCalledWith({
        botId: "bot-2",
        responsibilityId: "bot-2-responsibility",
        // Resolved from the live snapshot (R16-S), never the mount-time one.
        harness: { harnessId: "codex", explicitModel: null },
      }),
    );
  });

  it("passes the bot's stored harness with the run and reloads history after it settles", async () => {
    const onRunResponsibility = vi.fn(async () => {});
    const fake = fakeBridge([]);
    render(
      <BotsPanel
        snapshot={{
          bots: [
            bot({
              id: "bot-1",
              harnessPolicy: {
                defaultHarness: "pi",
                explicitModel: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
              },
              responsibilities: [responsibility({ name: "Nightly duty" })],
            }),
          ],
          history: [],
        }}
        bridge={fake.bridge}
        scope={scope}
        onRunResponsibility={onRunResponsibility}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Run Nightly duty" }),
    );
    await waitFor(() =>
      expect(onRunResponsibility).toHaveBeenCalledWith({
        botId: "bot-1",
        responsibilityId: "resp-1",
        harness: {
          harnessId: "pi",
          explicitModel: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
        },
      }),
    );
    // The reload after settlement is what makes the new history row appear.
    await waitFor(() => expect(fake.snapshots()).toBeGreaterThan(0));
  });

  it("surfaces a failed run as an alert instead of silence", async () => {
    const onRunResponsibility = vi.fn(async () => {
      throw new Error("Run refused.");
    });
    const fake = fakeBridge([]);
    render(
      <BotsPanel
        snapshot={{
          bots: [
            bot({ responsibilities: [responsibility({ name: "Nightly duty" })] }),
          ],
          history: [],
        }}
        bridge={fake.bridge}
        scope={scope}
        onRunResponsibility={onRunResponsibility}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Run Nightly duty" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Run refused."),
    );
  });

  it("creates a Bot, selects it and reloads the list", async () => {
    const fake = fakeBridge([]);
    render(
      <BotsPanel
        snapshot={{ bots: [], history: [] }}
        bridge={fake.bridge}
        scope={scope}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New Bot" }));
    fireEvent.change(screen.getByLabelText("Name (optional)"), {
      target: { value: "Acceptance Bot" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Bot" }));
    await waitFor(() => expect(screen.getByTestId("bot-detail")).toBeTruthy());
    expect(screen.getByTestId("bot-detail").textContent).toContain(
      "Acceptance Bot",
    );
    expect(fake.snapshots()).toBe(1);
  });

  it("surfaces a failed create as an alert and keeps the form open", async () => {
    const fake = fakeBridge([]);
    const failing = {
      ...fake.bridge,
      botCreate: async () => ({
        ok: false as const,
        error: { code: "busy", message: "daemon refused", retryable: false },
      }),
    };
    render(
      <BotsPanel
        snapshot={{ bots: [], history: [] }}
        bridge={failing}
        scope={scope}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New Bot" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Bot" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("daemon refused"),
    );
    expect(screen.getByRole("form", { name: "Create a Bot" })).toBeTruthy();
  });

  it("closes the create form on Escape, but not from inside its inputs", async () => {
    const fake = fakeBridge([]);
    const onClose = vi.fn();
    render(
      // The keep-alive host wrapper the Escape visibility check gates on
      // (App.tsx renders BotsPanel inside this section).
      <div data-testid="bots-page-host">
        <BotsPanel
          snapshot={{ bots: [], history: [] }}
          onClose={onClose}
          bridge={fake.bridge}
          scope={scope}
        />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "New Bot" }));
    const form = screen.getByRole("form", { name: "Create a Bot" });
    fireEvent.keyDown(screen.getByLabelText("Name (optional)"), {
      key: "Escape",
    });
    expect(screen.getByRole("form", { name: "Create a Bot" })).toBeTruthy();
    fireEvent.keyDown(form, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: "Create a Bot" })).toBeNull(),
    );
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId("bots-panel"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape while the keep-alive host is hidden (#270)", async () => {
    // The page stays mounted (display:none) after the user routes away;
    // without the visibility gate its window listener fired on every
    // Escape anywhere and popped the view history a second time, landing
    // on the Bots page instead of the workspace.
    Object.defineProperty(HTMLElement.prototype, "checkVisibility", {
      configurable: true,
      value() {
        return this.style.display !== "none";
      },
    });
    try {
      const fake = fakeBridge([]);
      const onClose = vi.fn();
      render(
        <div data-testid="bots-page-host" style={{ display: "none" }}>
          <BotsPanel
            snapshot={{ bots: [], history: [] }}
            onClose={onClose}
            bridge={fake.bridge}
            scope={scope}
          />
        </div>,
      );
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "checkVisibility");
    }
  });

  it("renders a recoverable error state when a refresh fails over an empty list", async () => {
    const fake = fakeBridge([]);
    fake.failNextSnapshotWith("profile unavailable");
    render(
      <BotsPanel
        snapshot={{ bots: [], history: [] }}
        bridge={fake.bridge}
        scope={scope}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh Bots" }));
    await waitFor(() =>
      expect(screen.getByText("Bots could not be loaded")).toBeTruthy(),
    );
    expect(screen.getByText("profile unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("bots-empty")).toBeTruthy());
  });

  it("shows the loading skeleton while a refresh is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = fakeBridge([bot()]);
    const snapshot = fake.bridge.botSnapshot;
    const gated = {
      ...fake.bridge,
      botSnapshot: async () => {
        await gate;
        return snapshot();
      },
    };
    render(
      <BotsPanel
        snapshot={{ bots: [], history: [] }}
        bridge={gated}
        scope={scope}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh Bots" }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Loading Bots" })).toBeTruthy(),
    );
    release();
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "Loading Bots" })).toBeNull(),
    );
  });

  it("adds a responsibility from the selected card and reloads", async () => {
    const fake = fakeBridge([bot()]);
    render(
      <BotsPanel
        snapshot={{ bots: [bot()], history: [] }}
        bridge={fake.bridge}
        scope={scope}
      />,
    );
    fireEvent.click(screen.getByTestId("open-session-bot-1"));
    fireEvent.click(screen.getByTestId("add-responsibility-bot-1"));
    const form = screen.getByTestId("responsibility-form");
    fireEvent.change(within(form).getByLabelText("Name"), {
      target: { value: "Nightly review" },
    });
    fireEvent.change(within(form).getByLabelText(/Cron expression/), {
      target: { value: "* * * * *" },
    });
    fireEvent.change(within(form).getByLabelText("Prompt"), {
      target: { value: "Review incoming work." },
    });
    fireEvent.click(
      within(form).getByRole("button", { name: "Save responsibility" }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("responsibility-form")).toBeNull(),
    );
    expect(fake.snapshots()).toBe(1);
  });

  it("deletes the selected bot through its confirm and reloads", async () => {
    const fake = fakeBridge([bot()]);
    render(
      <BotsPanel
        snapshot={{ bots: [bot()], history: [] }}
        bridge={fake.bridge}
        scope={scope}
      />,
    );
    fireEvent.click(screen.getByTestId("open-session-bot-1"));
    fireEvent.click(screen.getByTestId("delete-bot-bot-1"));
    fireEvent.click(
      within(screen.getByTestId("bot-delete-confirm")).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() => expect(screen.getByTestId("bots-empty")).toBeTruthy());
    expect(fake.snapshots()).toBe(1);
  });

  // #237: the mount registers over a placeholder snapshot while the live
  // one is in flight — first paint is the fork's loading state (never a
  // one-frame empty state), and hydration swaps in the rows.
  it("paints the loading state while the snapshot is pending, then hydrates", async () => {
    const fake = fakeBridge([bot()]);
    const { rerender } = render(
      <BotsPanel
        snapshot={{ bots: [], history: [] }}
        bridge={fake.bridge}
        scope={scope}
        snapshotPending
      />,
    );
    expect(screen.getByRole("status", { name: "Loading Bots" })).toBeTruthy();
    expect(screen.queryByTestId("bots-empty")).toBeNull();
    rerender(
      <BotsPanel
        snapshot={{ bots: [bot()], history: [] }}
        bridge={fake.bridge}
        scope={scope}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "Loading Bots" })).toBeNull(),
    );
    expect(screen.queryByTestId("bots-empty")).toBeNull();
  });
});
