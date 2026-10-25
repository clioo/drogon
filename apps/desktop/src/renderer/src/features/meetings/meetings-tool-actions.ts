// MIT Copyright (c) 2026 Lovecast Inc.
// Opening the recording tool and its notes folder from the Meetings page.
//
// The notes themselves are read-only, so the only useful action next to them
// is the tool that writes them: launching the installed bundle the daemon
// found, or revealing the folder it resolved in Finder. Drogon cannot start a
// recording itself — Write That Down exposes no URL scheme and no record verb,
// and inventing one would be a claim this integration does not have — so the
// copy says what the button actually does.
//
// Both helpers take the shell as an argument so a test drives a fake, and both
// return a message on failure instead of throwing: the page shows it as an
// alert rather than looking like the click did nothing.
import type { Result } from "../../../../shared/session-contract";

/** The slice of `window.drogon.shell` this page uses. */
export type MeetingsShell = {
  openPath?: (input: { path: string }) => Promise<Result<{ opened: boolean }>>;
  showItemInFolder?: (input: { path: string }) => Promise<Result<{ shown: boolean }>>;
};

export function meetingsShell(): MeetingsShell | null {
  if (typeof window === "undefined") return null;
  const shell = (window as unknown as { drogon?: { shell?: MeetingsShell } }).drogon?.shell;
  return shell ?? null;
}

function failure(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("ok" in result)) return null;
  if ((result as { ok: unknown }).ok !== false) return null;
  const message = (result as { error?: { message?: unknown } }).error?.message;
  return typeof message === "string" && message !== ""
    ? message
    : "This Drogon build could not complete that request.";
}

/**
 * Opens the Write That Down bundle the daemon resolved. Resolves to `null` on
 * success, or the message to show.
 */
export async function openWriteThatDown(
  appPath: string | null,
  shell: MeetingsShell | null = meetingsShell(),
): Promise<string | null> {
  if (!appPath) return "No Write That Down bundle was found on this Mac.";
  if (typeof shell?.openPath !== "function") {
    return "This Drogon build cannot open another app, so Write That Down has to be started from the Dock or Spotlight.";
  }
  try {
    return failure(await shell.openPath({ path: appPath }));
  } catch {
    return "Write That Down could not be opened.";
  }
}

/**
 * Reveals the resolved notes folder in Finder. Read-only by construction:
 * the shell is asked to show the folder, never to write to it.
 */
export async function revealNotesFolder(
  root: string | null,
  shell: MeetingsShell | null = meetingsShell(),
): Promise<string | null> {
  if (!root) return "Drogon has not resolved a notes folder on this Mac.";
  if (typeof shell?.showItemInFolder !== "function") {
    return "This Drogon build cannot reveal a folder.";
  }
  try {
    return failure(await shell.showItemInFolder({ path: root }));
  } catch {
    return "The notes folder could not be revealed.";
  }
}
