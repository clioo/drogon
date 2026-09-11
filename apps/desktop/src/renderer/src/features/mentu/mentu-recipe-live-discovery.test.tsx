// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Regression for the owner report "I could not see a recipe I had just
// created" and for the packaged acceptance journey it broke: the
// right-sidebar Mentu panel is a KEEP-ALIVE mount (App.tsx `mentuPanelAlive`)
// that is created as soon as the right sidebar has a workspace, so its recipe
// catalog used to be the snapshot taken at that first mount. A plain
// root-level recipe written into `<workspace>/.mentu/recipes` afterwards (a
// Bot, a terminal, an editor) never appeared in the selector until the whole
// app was reloaded. The catalog now follows the workspace's own
// files-changed tick (R16-L #157) — the same live path the Explorer, the
// EditorHost and Source Control already read — so discovery is a property of
// the directory, not of when the panel happened to mount.
//
// The tick path is deliberately narrow and these tests pin that down too:
// it re-reads the recipe list only, never the pinned runtime (whose read
// hashes the whole binary and spawns it for `--version`) and never a second
// read per tick while one is already in flight.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FilesChangedTick, FilesWatchBridge } from "../../../../shared/file-contract";
import type {
  MentuBridge,
  MentuRecipeSummary,
  MentuRecipesResult,
} from "../../../../shared/mentu-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { MentuPanel } from "./MentuPanel";

beforeEach(installRadixJsdomStubs);
afterEach(() => {
  cleanup();
  delete (window as unknown as { drogon?: unknown }).drogon;
});

const HELLO: MentuRecipeSummary = {
  id: "acceptance-hello",
  path: ".mentu/recipes/acceptance-hello.json",
  name: "acceptance-hello",
  valid: true,
  issue: null,
};

type Result<T> =
  | { ok: true; result: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

/** The real preload channel (`window.drogon.filesWatch`, main's watcher):
 *  every renderer subscriber is collected so the test can push the same
 *  coarse tick the app receives when a file lands. */
function installFilesWatchChannel(): {
  tick: (workspaceId: string) => void;
  subscriberCount: () => number;
} {
  const listeners = new Set<(tick: FilesChangedTick) => void>();
  const holder = window as unknown as {
    drogon?: { filesWatch?: FilesWatchBridge };
  };
  holder.drogon ??= {};
  holder.drogon.filesWatch = {
    onFilesChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    tick: (workspaceId) => {
      for (const listener of [...listeners]) listener({ workspaceId });
    },
    subscriberCount: () => listeners.size,
  };
}

/** A bridge over a directory the test mutates: `catalog` is the daemon's
 *  answer, so pushing a recipe into it is exactly "the file now exists". */
function directoryBridge(catalog: MentuRecipeSummary[]) {
  const bridge = {
    mentuRecipes: vi.fn(async (): Promise<Result<MentuRecipesResult>> => ({
      ok: true as const,
      result: { recipes: [...catalog] },
    })),
    mentuRuntime: vi.fn(async () => ({
      ok: true as const,
      result: {
        runtime: {
          available: true,
          path: "/bin/mentu-recipes",
          version: "fixture",
          expectedRevision: "r",
          expectedSha256: "s",
          actualSha256: "s",
          lockMatches: true,
          message: null,
        },
      },
    })),
  };
  return {
    bridge: bridge as unknown as MentuBridge,
    mentuRecipes: bridge.mentuRecipes,
    mentuRuntime: bridge.mentuRuntime,
  };
}

/** Radix Select opens on the pointer press the browser sends. */
async function openRecipeSelector(): Promise<void> {
  const trigger = screen.getByRole("combobox", { name: "Recipe" });
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
}

describe("Mentu panel recipe discovery", () => {
  it("offers a root-level recipe that appears after the panel mounted", async () => {
    const watch = installFilesWatchChannel();
    const catalog: MentuRecipeSummary[] = [];
    const { bridge, mentuRecipes, mentuRuntime } = directoryBridge(catalog);
    render(<MentuPanel bridge={bridge} workspaceId="ws-live" />);
    await waitFor(() => expect(mentuRecipes).toHaveBeenCalledTimes(1));
    // The panel discovered nothing yet: the selector is disabled, which is
    // how a user sees "no recipes" — and why a snapshot catalog is a lie
    // the moment a recipe lands.
    const trigger = screen.getByRole("combobox", { name: "Recipe" });
    expect(trigger.hasAttribute("disabled")).toBe(true);

    // A Bot/terminal writes a plain recipe at the recipes root and main's
    // watcher reports the change for this workspace.
    catalog.push(HELLO);
    watch.tick("ws-live");

    expect(watch.subscriberCount()).toBe(1);
    await waitFor(() => expect(mentuRecipes).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Recipe" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    await openRecipeSelector();
    expect(screen.getByRole("option", { name: "acceptance-hello" })).toBeTruthy();
    // The tick read the list, not the runtime: re-reading the runtime would
    // hash the locked binary and spawn it for `--version` on every file
    // change in the workspace, which no directory listing justifies.
    expect(mentuRuntime).toHaveBeenCalledTimes(1);
  });

  it("keeps one coarse tick from becoming a re-read storm", async () => {
    const watch = installFilesWatchChannel();
    const catalog: MentuRecipeSummary[] = [];
    const { bridge } = directoryBridge(catalog);
    const gate: { release?: () => void } = {};
    const read = vi.fn(
      () =>
        new Promise<Result<MentuRecipesResult>>((resolve) => {
          gate.release = () => resolve({ ok: true, result: { recipes: [...catalog] } });
        }),
    );
    bridge.mentuRecipes = read;
    render(<MentuPanel bridge={bridge} workspaceId="ws-burst" />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

    // Three files land while the first re-read is still in flight. The
    // daemon's answer is the whole directory, so the burst must collapse
    // into at most one further read rather than three.
    watch.tick("ws-burst");
    watch.tick("ws-burst");
    watch.tick("ws-burst");
    expect(read).toHaveBeenCalledTimes(2);
    gate.release?.();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    gate.release?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("keeps a discovery already in the selector and ignores other workspaces' ticks", async () => {
    const watch = installFilesWatchChannel();
    const catalog: MentuRecipeSummary[] = [HELLO];
    const { bridge, mentuRecipes } = directoryBridge(catalog);
    render(<MentuPanel bridge={bridge} workspaceId="ws-scoped" />);
    await waitFor(() => expect(mentuRecipes).toHaveBeenCalledTimes(1));

    watch.tick("ws-somewhere-else");
    // A tick that is not this workspace's must not re-read: the reader is
    // scoped, not a workspace-wide refresh storm.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mentuRecipes).toHaveBeenCalledTimes(1);

    await openRecipeSelector();
    expect(screen.getByRole("option", { name: "acceptance-hello" })).toBeTruthy();
  });
});
