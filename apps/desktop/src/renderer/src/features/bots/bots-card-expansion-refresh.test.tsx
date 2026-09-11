// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
 * Regression for the owner's report: "cuando expando al bot, se vuelve
 * automáticamente a colapsar". The Bots snapshot is polled (App.tsx: 4 s),
 * each poll mints a NEW route descriptor bound to the fresh snapshot, and
 * the App mount rendered that descriptor as `<Component />`. A new function
 * identity is a new element TYPE, so React unmounted and remounted the whole
 * BotsPanel on every poll, wiping the controller's per-bot expansion (and
 * every other local disclosure/selection) a moment after the click.
 *
 * These cases go through the real App mount boundary (`MountedPanel` +
 * `registerBotsRoute`) with a fresh snapshot pushed in, because a test that
 * renders BotsPanel directly with a new `snapshot` prop never reproduced the
 * bug: the controller keeps its own state across prop changes and only the
 * remount destroyed it. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { BotBridge } from "../../../../shared/bot-contract";
import type { Status, Workspace } from "../../../../shared/session-contract";
import { MountedPanel } from "../../App";
import { clearBotCardExpansion } from "./bot-card-expansion-preference";
import {
  BOTS_CAPABILITY,
  BOTS_ROUTE_ID,
  buildBotsPanelProps,
  registerBotsRoute,
} from "../../bots-mount";
import {
  createRouteRegistry,
  registerRoute,
  resolveRoute,
  routeId,
} from "../../route-panel-contract";
import type { PanelDescriptor } from "../../route-panel-contract";
import type {
  BotsPanelBot,
  BotsPanelResponsibility,
  BotsPanelSession,
  BotsPanelSnapshot,
} from "./bots-panel-contracts";

afterEach(cleanup);

// The disclosure envelope is process-wide; each case starts from "the user
// has never touched a card".
beforeEach(() => clearBotCardExpansion());

const scope = { hostId: "host-1", workspaceId: "ws-1", locale: "en-US" };
const workspace: Workspace = {
  id: "ws-1",
  path: "/tmp/ws-1",
  name: "ws-1",
  kind: "folder",
  hostId: "host-1",
};
const status: Status = {
  hostId: "host-1",
  serviceInstanceId: "svc-1",
  protocol: 1,
  capabilities: [BOTS_CAPABILITY],
  version: "0.1.0",
};

const duty: BotsPanelResponsibility = {
  id: "resp-1",
  name: "Review duty",
  instructions: "Inspect the workspace.",
  kind: "scheduled",
  trigger: { kind: "scheduled", automationId: "auto-1" },
  enabled: true,
  recipe: null,
  createdAt: 1,
  updatedAt: 1,
};

/** A Bot with nothing configured: the compact collapsed row from the
 *  owner's screenshot ("No automations or monitors yet" + "+ Add" + ">"). */
function unconfiguredBot(overrides: Partial<BotsPanelBot> = {}): BotsPanelBot {
  return {
    id: "bot-1",
    characterPreset: "none",
    displayIdentity: {
      displayName: "Daenerys Targaryen",
      handle: null,
      title: null,
    },
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

const liveSession: BotsPanelSession = {
  sessionId: "sess-1",
  harness: "codex",
  model: null,
  startedAt: 1,
  rotatedAt: null,
  processId: 1234,
  incarnation: "inc-1",
  verdict: "live",
};

function snapshotOf(bots: BotsPanelBot[]): BotsPanelSnapshot {
  return { bots, history: [] };
}

function baseRegistry() {
  return registerRoute(
    createRouteRegistry({
      capabilities: [BOTS_CAPABILITY],
      fallbackId: routeId("terminal"),
    }),
    { id: routeId("terminal"), title: "Terminal", component: () => null },
  );
}

/** The App's own wiring, reduced to what the mount boundary does: a fresh
 *  registry + descriptor for every snapshot identity (App.tsx's
 *  `panelRegistry` useMemo is keyed on `botsLoad`). */
function AppBotsMount({ snapshot }: { snapshot: BotsPanelSnapshot }) {
  const descriptor: PanelDescriptor = useMemo(() => {
    const bridge: BotBridge = {
      botSnapshot: async () => ({
        ok: true as const,
        result: {
          ...scope,
          bots: snapshot.bots,
          history: snapshot.history,
        },
      }),
    };
    const registry = registerBotsRoute(
      baseRegistry(),
      bridge,
      buildBotsPanelProps(snapshot, undefined, scope),
    );
    return resolveRoute(registry, BOTS_ROUTE_ID);
  }, [snapshot]);
  return (
    <MountedPanel descriptor={descriptor} workspace={workspace} status={status} />
  );
}

/** The card's disclosure control (same testid in both states), once the
 *  mount's own first read has settled — the controller paints the loading
 *  state until then, and a remount paints it again. */
async function expander(botId = "bot-1"): Promise<HTMLElement> {
  return screen.findByTestId(`bot-expand-${botId}`);
}

async function expansion(botId = "bot-1"): Promise<string | null> {
  return (await expander(botId)).getAttribute("aria-expanded");
}

describe("Bot card expansion survives snapshot refreshes", () => {
  it("stays expanded when the next polled snapshot lands", async () => {
    const { rerender } = render(
      <AppBotsMount snapshot={snapshotOf([unconfiguredBot()])} />,
    );
    // Default for a bot with nothing configured: the compact collapsed row.
    const before = await expander();
    expect(before.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("No automations or monitors yet")).toBeTruthy();

    fireEvent.click(before);
    expect(await expansion()).toBe("true");

    // One poll later: the same bots under a brand new snapshot identity
    // (App stores a fresh object every read, so the descriptor is re-minted).
    rerender(<AppBotsMount snapshot={snapshotOf([unconfiguredBot()])} />);
    expect(await expansion()).toBe("true");
  });

  it("keeps an expanded idle Bot expanded when it starts working", async () => {
    const { rerender } = render(
      <AppBotsMount snapshot={snapshotOf([unconfiguredBot()])} />,
    );
    fireEvent.click(await expander());
    expect(await expansion()).toBe("true");

    // idle → working: the Bot's own record now carries a live session.
    rerender(
      <AppBotsMount
        snapshot={snapshotOf([
          unconfiguredBot({ currentSession: liveSession }),
        ])}
      />,
    );
    expect(await expansion()).toBe("true");
  });

  it("keeps a collapsed working Bot collapsed when its state changes", async () => {
    // A configured Bot defaults to the full card; the user folds it to the
    // compact row because that is the view they want for it.
    const { rerender } = render(
      <AppBotsMount
        snapshot={snapshotOf([
          unconfiguredBot({
            responsibilities: [duty],
            currentSession: liveSession,
          }),
        ])}
      />,
    );
    const before = await expander();
    expect(before.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(before);
    expect(await expansion()).toBe("false");

    // Same Bot, next poll, still working — the fold must not spring back.
    rerender(
      <AppBotsMount
        snapshot={snapshotOf([
          unconfiguredBot({
            responsibilities: [duty],
            currentSession: { ...liveSession, processId: 4321 },
          }),
        ])}
      />,
    );
    expect(await expansion()).toBe("false");
  });

  it("stays expanded when an unrelated Bot updates", async () => {
    const { rerender } = render(
      <AppBotsMount snapshot={snapshotOf([unconfiguredBot()])} />,
    );
    fireEvent.click(await expander());
    expect(await expansion()).toBe("true");

    rerender(
      <AppBotsMount
        snapshot={snapshotOf([
          unconfiguredBot(),
          unconfiguredBot({
            id: "bot-2",
            displayIdentity: {
              displayName: "Second Bot",
              handle: null,
              title: null,
            },
          }),
        ])}
      />,
    );
    expect(await expansion()).toBe("true");
  });

  it("keeps the choice across a renderer reload (fresh mount)", async () => {
    const first = render(
      <AppBotsMount snapshot={snapshotOf([unconfiguredBot()])} />,
    );
    fireEvent.click(await expander());
    expect(await expansion()).toBe("true");
    first.unmount();

    // A reload mounts the panel from the persisted envelope with no in-memory
    // state left over. The explicit expansion must come back with it.
    render(<AppBotsMount snapshot={snapshotOf([unconfiguredBot()])} />);
    expect(await expansion()).toBe("true");
  });

  it("does not rebuild the panel on a poll (filter text survives)", async () => {
    const { rerender } = render(
      <AppBotsMount snapshot={snapshotOf([unconfiguredBot()])} />,
    );
    const filter = (await screen.findByTestId(
      "bots-filter-input",
    )) as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "daenerys" } });

    rerender(<AppBotsMount snapshot={snapshotOf([unconfiguredBot()])} />);
    expect(
      ((await screen.findByTestId("bots-filter-input")) as HTMLInputElement)
        .value,
    ).toBe("daenerys");
  });

  it("keeps the collapsed row compact and its + Add working", async () => {
    render(<AppBotsMount snapshot={snapshotOf([unconfiguredBot()])} />);
    // Nothing configured still renders the compact row: the info tiles and
    // the responsibility chip row are expanded-only.
    await expander();
    expect(screen.queryByText("Responsibilities:")).toBeNull();
    expect(screen.queryByText("Harness")).toBeNull();

    fireEvent.click(screen.getByTestId("add-responsibility-bot-1"));
    expect(screen.getByTestId("responsibility-form")).toBeTruthy();
  });
});
