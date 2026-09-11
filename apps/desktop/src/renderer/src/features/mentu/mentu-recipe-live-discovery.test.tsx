// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Regression for the owner report "I could not see a recipe I had just
// created" and for the packaged acceptance journey it broke: the
// right-sidebar Mentu panel is a KEEP-ALIVE mount (App.tsx `mentuPanelAlive`)
// that mounts as soon as the right sidebar has a workspace, so its recipe
// catalog used to be the snapshot taken at that first mount. A plain
// root-level recipe written into `<workspace>/.mentu/recipes` afterwards (a
// Bot, a terminal, an editor) never appeared in the selector until the whole
// app was reloaded. The catalog now follows the workspace's own
// files-changed tick (R16-L #157) — the same live path the Explorer and
// Source Control already use — so discovery is a property of the directory,
// not of when the panel happened to mount.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FilesChangedTick, FilesWatchBridge } from "../../../../shared/file-contract";
import type { MentuBridge, MentuRecipeSummary } from "../../../../shared/mentu-contract";
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
    mentuRecipes: vi.fn(async () => ({
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
  return { bridge: bridge as unknown as MentuBridge, mentuRecipes: bridge.mentuRecipes };
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
    const { bridge, mentuRecipes } = directoryBridge(catalog);
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
