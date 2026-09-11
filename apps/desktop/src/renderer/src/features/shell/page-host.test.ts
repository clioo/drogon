/* MIT Copyright (c) 2026 Lovecast Inc. Routing contract for the App page
   host (features/shell/page-host.ts): which routes replace the session view
   as standalone pages, and that view-history Back/Close restores the
   session view. App itself has no unit harness, so these tests pin the
   model App applies: the route classification plus the history entries
   Back walks back to. */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { AUTOMATIONS_ROUTE_ID } from "../../automations-mount";
import { BOTS_ROUTE_ID } from "../../bots-mount";
import { MEETINGS_ROUTE_ID } from "../../meetings-mount";
import { SETTINGS_ROUTE_ID } from "../settings/settings-route";
import { TASKS_ROUTE_ID } from "../tasks/TasksPage";
import { isFullPageRoute, noWorkspacePageCopy } from "./page-host";
import {
  currentView,
  goBackView,
  initialViewHistory,
  pushView,
} from "./view-history";

describe("isFullPageRoute", () => {
  it("treats Bots, Tasks, Automations and Meetings as standalone pages", () => {
    assert.equal(isFullPageRoute(BOTS_ROUTE_ID), true);
    assert.equal(isFullPageRoute(TASKS_ROUTE_ID), true);
    assert.equal(isFullPageRoute(AUTOMATIONS_ROUTE_ID), true);
    // Meetings replaces the session view too: the notes live outside any
    // workspace, so nothing in the session chrome applies to it.
    assert.equal(isFullPageRoute(MEETINGS_ROUTE_ID), true);
  });
  it("keeps the session view for landing, settings and session tabs", () => {
    assert.equal(isFullPageRoute(null), false);
    assert.equal(isFullPageRoute(SETTINGS_ROUTE_ID), false);
    // The Mentu tab is a session tab (the work graph), never a page.
    assert.equal(isFullPageRoute("mentu"), false);
    assert.equal(isFullPageRoute("files"), false);
    assert.equal(isFullPageRoute("changes"), false);
  });
});

describe("no-workspace page routing", () => {
  it("keeps workspace-scoped navigation visible without a workspace", () => {
    // #348 (R17-E): the fork renders its full Bots surface with zero
    // workspaces (AppWorkspaceShell.tsx mounts BotsPage with no workspace
    // condition), so Bots no longer routes through NoWorkspacePage — the
    // copy is null and the real page mounts. Automations stays gated.
    assert.equal(noWorkspacePageCopy(BOTS_ROUTE_ID), null);
    assert.deepEqual(noWorkspacePageCopy(AUTOMATIONS_ROUTE_ID), {
      title: "Automations",
      description: "Schedule repeatable work for your workspaces.",
    });
    assert.equal(noWorkspacePageCopy(TASKS_ROUTE_ID), null);
    // Meetings is workspace-independent (files on disk), so it needs no
    // workspace gate at all.
    assert.equal(noWorkspacePageCopy(MEETINGS_ROUTE_ID), null);
    assert.equal(noWorkspacePageCopy(null), null);
  });
});

describe("page Back/Close restores the session view", () => {
  it("Back from a page returns to the previous session entry", () => {
    const workspaceId = "workspace-1";
    let history = initialViewHistory({ route: null, workspaceId });
    history = pushView(history, { route: TASKS_ROUTE_ID, workspaceId });
    assert.equal(isFullPageRoute(currentView(history).route), true);
    history = goBackView(history);
    const restored = currentView(history);
    assert.equal(restored.route, null);
    assert.equal(isFullPageRoute(restored.route), false);
  });
  it("Close from each page returns to the entry it was opened from", () => {
    for (const page of [BOTS_ROUTE_ID, TASKS_ROUTE_ID, AUTOMATIONS_ROUTE_ID]) {
      const workspaceId = "workspace-1";
      let history = initialViewHistory({ route: null, workspaceId });
      history = pushView(history, { route: page, workspaceId });
      const restored = currentView(goBackView(history));
      assert.equal(restored.route, null);
      assert.equal(isFullPageRoute(restored.route), false);
    }
  });
});
