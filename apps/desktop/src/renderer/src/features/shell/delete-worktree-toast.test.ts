// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/sidebar/delete-worktree-toast.ts behavior
// (literal English copy expectations for every force-delete branch).
import { describe, expect, test } from "vitest";
import {
  canForceDeleteAfterRemovalFailure,
  classifyWorktreeRemovalFailure,
  getDeleteWorktreeToastCopy,
  isLockedWorktreeRemovalError,
  isProvenLivePtyRemovalError,
  isUnsettledSessionRemovalError,
} from "./delete-worktree-toast";

/**
 * The exact refusals `crates/drogon-core/src/workspace_session_settle.rs`
 * builds (issue #621). The bridge hands the renderer `error.message` and
 * drops the code, so these strings are the whole contract between the two
 * sides; the daemon pins its half in the same module's unit tests.
 */
const DAEMON_PROVEN_LIVE =
  "This workspace still has running terminals, so nothing was deleted — still live: ses_1. Delete with force to stop them first.";
const DAEMON_PROVEN_LIVE_FORCED =
  "This workspace still has running terminals, so nothing was deleted — still live: ses_1. Drogon signalled them and could not confirm they exited.";
const DAEMON_UNVERIFIABLE =
  "Drogon could not confirm every terminal in this workspace has exited, so nothing was deleted: ses_ghost. Force cannot settle a terminal Drogon has lost contact with — close those terminals, then delete again.";

describe("getDeleteWorktreeToastCopy", () => {
  test("generic failure is destructive and echoes the error", () => {
    expect(getDeleteWorktreeToastCopy("demo", null, "boom")).toEqual({
      title: "Failed to delete workspace demo",
      description: "boom",
      isDestructive: true,
    });
  });

  test("locked failure offers Force Delete and names the unlock command", () => {
    const copy = getDeleteWorktreeToastCopy(
      "demo",
      null,
      "cannot remove a locked working tree",
    );
    expect(copy.title).toBe("Failed to delete workspace demo");
    // #604: Force sends git's `remove -f -f`, so it is a real way out of a
    // locked workspace and not only the unlock-then-retry detour.
    expect(copy.description).toContain("Use Force Delete");
    expect(copy.description).toContain("git worktree unlock <worktree-path>");
    expect(copy.isDestructive).toBe(false);
  });

  test("locked failure with a reason quotes git's report", () => {
    const copy = getDeleteWorktreeToastCopy(
      "demo",
      null,
      "cannot remove a locked working tree",
      "admin lock",
    );
    expect(copy.description).toContain("admin lock");
    expect(copy.isDestructive).toBe(false);
  });

  test("orphan directory points at Force Delete", () => {
    const copy = getDeleteWorktreeToastCopy("demo", "orphan-directory", "gone");
    expect(copy.description).toContain("Use Force Delete");
    expect(copy.isDestructive).toBe(false);
  });

  test("unstopped PTY distinguishes proven-live terminals", () => {
    const live = getDeleteWorktreeToastCopy(
      "demo",
      "unstopped-pty",
      "stop failed — still live: pts/0",
    );
    expect(live.description).toContain("still has running terminals");
    const unproven = getDeleteWorktreeToastCopy(
      "demo",
      "unstopped-pty",
      "stop failed",
    );
    expect(unproven.description).toContain("could not confirm");
  });

  test("missing registration and dirty cases name the force path", () => {
    const missing = getDeleteWorktreeToastCopy(
      "demo",
      "missing-registration",
      "gone",
    ).description;
    expect(missing).toContain("Use Force Delete");
    // User-visible copy names this product, not the one it was ported from.
    expect(missing).toContain("clear it from Drogon");
    expect(missing).not.toContain("Orca");
    expect(
      getDeleteWorktreeToastCopy("demo", "dirty", "dirty").description,
    ).toContain("Use Force Delete");
  });
});

describe("removal error classifiers", () => {
  test("locked matcher anchors on git's wording", () => {
    expect(isLockedWorktreeRemovalError("cannot remove a locked working tree")).toBe(
      true,
    );
    expect(isLockedWorktreeRemovalError("plain failure")).toBe(false);
  });

  test("proven-live matcher needs the live marker", () => {
    expect(isProvenLivePtyRemovalError("stop failed — still live: pts/0")).toBe(true);
    expect(isProvenLivePtyRemovalError("stop failed")).toBe(false);
  });

  test("both daemon refusals read as unsettled sessions", () => {
    expect(isUnsettledSessionRemovalError(DAEMON_PROVEN_LIVE)).toBe(true);
    expect(isUnsettledSessionRemovalError(DAEMON_UNVERIFIABLE)).toBe(true);
    expect(
      isUnsettledSessionRemovalError("fatal: 'busy' is a dirty working tree"),
    ).toBe(false);
  });

  test("only the daemon's proven-live refusal claims proven life", () => {
    expect(isProvenLivePtyRemovalError(DAEMON_PROVEN_LIVE)).toBe(true);
    expect(isProvenLivePtyRemovalError(DAEMON_UNVERIFIABLE)).toBe(false);
  });
});

describe("classifyWorktreeRemovalFailure", () => {
  test("an unforced session refusal offers the unstopped-pty recovery", () => {
    expect(classifyWorktreeRemovalFailure(DAEMON_PROVEN_LIVE, false)).toBe(
      "unstopped-pty",
    );
    expect(classifyWorktreeRemovalFailure(DAEMON_UNVERIFIABLE, false)).toBe(
      "unstopped-pty",
    );
  });

  test("a failure force cannot clear keeps the plain destructive toast", () => {
    expect(
      classifyWorktreeRemovalFailure("cannot remove a locked working tree", false),
    ).toBeNull();
    expect(classifyWorktreeRemovalFailure("boom", false)).toBeNull();
  });

  test("only a terminal Drogon still holds offers the force button", () => {
    // Both refusals get the unstopped-pty copy, but forcing can only settle
    // a PTY this process holds: the daemon refuses the lost-contact case
    // again under force, so offering the button would be a dead end.
    expect(canForceDeleteAfterRemovalFailure(DAEMON_PROVEN_LIVE, false)).toBe(
      true,
    );
    expect(canForceDeleteAfterRemovalFailure(DAEMON_UNVERIFIABLE, false)).toBe(
      false,
    );
    expect(canForceDeleteAfterRemovalFailure(DAEMON_PROVEN_LIVE, true)).toBe(
      false,
    );
    expect(canForceDeleteAfterRemovalFailure("boom", false)).toBe(false);
  });

  test("an already-forced attempt never points back at Force Delete", () => {
    expect(classifyWorktreeRemovalFailure(DAEMON_PROVEN_LIVE, true)).toBeNull();
    expect(classifyWorktreeRemovalFailure(DAEMON_UNVERIFIABLE, true)).toBeNull();
    expect(
      classifyWorktreeRemovalFailure(DAEMON_PROVEN_LIVE_FORCED, true),
    ).toBeNull();
  });

  test("a forced refusal falls through to copy that does not re-offer force", () => {
    // Nothing reclassifies an already-forced failure, so the daemon's own
    // sentence is the whole message: it must not send the user back to the
    // button that just failed.
    const copy = getDeleteWorktreeToastCopy(
      "busy",
      null,
      DAEMON_PROVEN_LIVE_FORCED,
    );
    expect(copy.description).toBe(DAEMON_PROVEN_LIVE_FORCED);
    expect(copy.description).not.toContain("with force");
    expect(copy.isDestructive).toBe(true);
  });
});

describe("daemon refusal copy end to end", () => {
  test("the proven-live refusal renders the running-terminals copy", () => {
    const copy = getDeleteWorktreeToastCopy(
      "busy",
      classifyWorktreeRemovalFailure(DAEMON_PROVEN_LIVE, false),
      DAEMON_PROVEN_LIVE,
    );
    expect(copy.description).toContain("still has running terminals");
    expect(copy.description).toContain("Drogon");
    expect(copy.isDestructive).toBe(false);
  });

  test("the unverifiable refusal renders the could-not-confirm copy", () => {
    const copy = getDeleteWorktreeToastCopy(
      "ghosted",
      classifyWorktreeRemovalFailure(DAEMON_UNVERIFIABLE, false),
      DAEMON_UNVERIFIABLE,
    );
    expect(copy.description).toContain("could not confirm every terminal");
    expect(copy.description).not.toContain("will kill them");
    // The daemon refuses this case under force too, so the copy must not
    // send anyone to a button that cannot help them.
    expect(copy.description).toContain("close those terminals");
    expect(copy.description).not.toContain("Use Force Delete to remove it");
  });
});
