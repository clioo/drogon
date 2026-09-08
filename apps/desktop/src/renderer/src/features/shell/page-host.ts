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
