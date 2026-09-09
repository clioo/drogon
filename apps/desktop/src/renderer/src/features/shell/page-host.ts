/* MIT Copyright (c) 2026 Lovecast Inc. Full-page route classification for
   the App page host. No single fork equivalent: the fork derives this from
   its AppChromeLayout/activeView, while Drogon routes by route id. Bots,
   Tasks and Automations replace the session view (no session header, no
   terminal column, no right sidebar); every other route — including the
   Mentu tab — stays nested in it. Back/Close return through the view
   history, which already restores the previous session entry. */
import { AUTOMATIONS_ROUTE_ID } from "../../automations-mount";
import { BOTS_ROUTE_ID } from "../../bots-mount";
import { TASKS_ROUTE_ID } from "../tasks/TasksPage";

/** True for the routes that render as standalone pages, like the fork's
 *  ActivePage (tasks/automations/bots replace the workbench there). */
export function isFullPageRoute(route: string | null): boolean {
  return (
    route === BOTS_ROUTE_ID ||
    route === TASKS_ROUTE_ID ||
    route === AUTOMATIONS_ROUTE_ID
  );
}

export type NoWorkspacePageCopy = {
  title: string;
  description: string;
};

/**
 * Automations is workspace-scoped, but its navigation should not
 * become inert while the first project is being added. Bots is excluded
 * too (fixes #348): the fork renders its Bots surface regardless of
 * workspaces (AppWorkspaceShell.tsx:81 mounts BotsPage for activeView
 * 'bots' with no workspace condition), so its route mounts the real page.
 * Tasks is likewise excluded: its page is project-scoped and can mount
 * before any workspace exists so the first task can create one.
 */
export function noWorkspacePageCopy(
  route: string | null,
): NoWorkspacePageCopy | null {
  if (route === AUTOMATIONS_ROUTE_ID)
    return {
      title: "Automations",
      description: "Schedule repeatable work for your workspaces.",
    };
  return null;
}
