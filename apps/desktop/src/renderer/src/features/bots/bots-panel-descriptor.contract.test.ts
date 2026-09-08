import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import {
  createBotsPanelDescriptor,
  type BotsPanelDescriptor,
} from "./bots-panel-descriptor";
import type { BotsPanelSnapshot } from "./bots-panel-contracts";

// Contract test for the V4-B4 PanelDescriptor factory. The shared
// route/panel contract (c5fea1d:apps/desktop/src/renderer/src/
// route-panel-contract.ts, branch codex/vertical-integration) is adapted
// structurally: it is NOT importable at this branch's HEAD and is never
// copied into this package. The factory builds the descriptor object from
// caller-supplied inputs only and registers/mounts nothing — registerRoute,
// the registry and the App mount point stay V2/ROOT-owned.

function snapshot(
  overrides: Partial<BotsPanelSnapshot> = {},
): BotsPanelSnapshot {
  return {
    bots: [
      {
        id: "bot-1",
        characterPreset: "none",
        displayIdentity: { displayName: "Watcher", handle: null, title: null },
        harnessPolicy: { defaultHarness: "codex", explicitModel: null },
        instructions: "",
        memories: [],
        responsibilities: [
          {
            id: "resp-1",
            name: "Nightly review",
            instructions: "Inspect the workspace.",
            kind: "scheduled",
            trigger: { kind: "scheduled", automationId: "auto-1" },
            enabled: true,
            recipe: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        currentSession: {
          sessionId: "session-stale",
          harness: "codex",
          model: null,
          startedAt: 1,
          rotatedAt: null,
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    history: [],
    ...overrides,
  };
}

function renderComponent(
  descriptor: BotsPanelDescriptor,
  hostProps: { session: unknown },
): string {
  return renderToStaticMarkup(descriptor.component(hostProps) as ReactElement);
}

describe("createBotsPanelDescriptor", () => {
  it("builds the descriptor with the id taken from the caller-supplied route id", () => {
    const descriptor = createBotsPanelDescriptor({
      routeId: "bots.panel",
      title: "Bots",
      panel: { snapshot: snapshot() },
    });
    expect(descriptor.id).toBe("bots.panel");
    expect(descriptor.title).toBe("Bots");
    expect(typeof descriptor.component).toBe("function");
  });

  it("rejects an empty or whitespace-only route id (routeId invariant of the shared contract)", () => {
    for (const bad of ["", "   "]) {
      expect(() =>
        createBotsPanelDescriptor({
          routeId: bad,
          title: "Bots",
          panel: { snapshot: snapshot() },
        }),
      ).toThrow();
    }
  });

  it("threads capability, restoreState and focus/cleanup hooks verbatim and invents no gate", () => {
    const onFocus = (): void => undefined;
    const onCleanup = (): void => undefined;
    const bare = createBotsPanelDescriptor({
      routeId: "bots.panel",
      title: "Bots",
      panel: { snapshot: snapshot() },
    });
    expect(bare).not.toHaveProperty("capability");
    expect(bare).not.toHaveProperty("restoreState");
    expect(bare).not.toHaveProperty("onFocus");
    expect(bare).not.toHaveProperty("onCleanup");

    const gated = createBotsPanelDescriptor({
      routeId: "bots.panel",
      title: "Bots",
      panel: { snapshot: snapshot() },
      capability: "bots.service",
      restoreState: { lastRoute: "bots.panel" },
      onFocus,
      onCleanup,
    });
    expect(gated.capability).toBe("bots.service");
    expect(gated.restoreState).toEqual({ lastRoute: "bots.panel" });
    expect(gated.onFocus).toBe(onFocus);
    expect(gated.onCleanup).toBe(onCleanup);
  });

  it("renders the panel purely from the caller-supplied list/history snapshot and threaded dispatch callback", () => {
    const descriptor = createBotsPanelDescriptor({
      routeId: "bots.panel",
      title: "Bots",
      panel: {
        snapshot: snapshot(),
        onRunResponsibility: () => {},
      },
    });
    const markup = renderComponent(descriptor, { session: null });
    expect(markup).toContain("Watcher");
    expect(markup).toContain('data-bot-id="bot-1"');
    expect(markup).toContain('data-responsibility-id="resp-1"');
    expect(markup).toContain("Run Nightly review");

    const ungated = createBotsPanelDescriptor({
      routeId: "bots.panel",
      title: "Bots",
      panel: { snapshot: snapshot() },
    });
    // #348 fork parity: the run control renders with or without the
    // dispatch callback — only its click effect is gated.
    expect(renderComponent(ungated, { session: null })).toContain(
      'data-bot-id="bot-1"',
    );
  });

  it("treats the host session as nullable and never as a liveness source", () => {
    const descriptor = createBotsPanelDescriptor({
      routeId: "bots.panel",
      title: "Bots",
      panel: { snapshot: snapshot() },
    });
    const withNull = renderComponent(descriptor, { session: null });
    const withStoredSession = renderComponent(descriptor, {
      session: {
        id: "host-session-1",
        workspaceId: "w1",
        hostId: "h1",
        incarnation: "inc-1",
        command: "/bin/sh",
        args: [],
        cols: 80,
        rows: 24,
        verdict: "live",
        exitCode: null,
        createdAt: "2026-01-01T00:00:00Z",
      },
    });
    expect(withNull).toBe(withStoredSession);
    expect(withNull).toContain("Session linked");
    expect(withNull).not.toContain("Observed liveness");
    expect(withNull).not.toContain("live");
  });

  it("never renders an observed-liveness line, even when the caller threads one (#348)", () => {
    const descriptor = createBotsPanelDescriptor({
      routeId: "bots.panel",
      title: "Bots",
      panel: {
        snapshot: snapshot(),
        observedLivenessByBotId: { "bot-1": "unverifiable" },
      },
    });
    const markup = renderComponent(descriptor, { session: null });
    expect(markup).not.toContain("Observed liveness");
    expect(markup).toContain("Session linked");
  });

  it("exposes exactly the shared descriptor surface and registers nothing", () => {
    const descriptor = createBotsPanelDescriptor({
      routeId: "bots.panel",
      title: "Bots",
      panel: { snapshot: snapshot() },
    });
    expect(Object.keys(descriptor).sort()).toEqual([
      "component",
      "id",
      "title",
    ]);
    const gated = createBotsPanelDescriptor({
      routeId: "bots.panel",
      title: "Bots",
      panel: { snapshot: snapshot() },
      capability: "bots.service",
      restoreState: null,
      onFocus: () => undefined,
      onCleanup: () => undefined,
    });
    expect(Object.keys(gated).sort()).toEqual([
      "capability",
      "component",
      "id",
      "onCleanup",
      "onFocus",
      "restoreState",
      "title",
    ]);
  });
});
