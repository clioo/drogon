// MIT Copyright (c) 2026 Lovecast Inc.
// Bot-session persistence fix: "si cambio de sesion, los bots de ahi
// desaparecen" (the owner's report). A Bot's session lives in the Bot's OWN
// home workspace, but the app's ordinary tab-strip session list is
// deliberately scoped to whichever workspace is currently `selected` (see
// App.tsx's `window.drogon.sessions(selected)` fetch) -- that scoping is
// correct for the tab strip itself
// (tab-strip-membership-persists-per-workspace) and stays untouched. A Bot
// session must stay reachable/truthful (the sidebar's Chats row, the Gap-2
// resume check) for as long as it lives, regardless of which workspace
// happens to be selected, so those two call sites need a HOST-WIDE session
// view instead. This is the pure merge: the currently selected workspace's
// own push-updated list wins per session id (it is the freshest copy); the
// host-wide poll fills in every other workspace's sessions.
import type { Session } from "../../../../shared/session-contract";

export function mergeSessionsForBots(
  hostWideSessions: readonly Session[],
  currentWorkspaceSessions: readonly Session[],
): Session[] {
  const merged = new Map(hostWideSessions.map((item) => [item.id, item]));
  for (const item of currentWorkspaceSessions) merged.set(item.id, item);
  return [...merged.values()];
}
