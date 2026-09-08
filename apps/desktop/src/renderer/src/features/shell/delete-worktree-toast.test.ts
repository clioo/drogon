// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/sidebar/delete-worktree-toast.ts behavior
// (literal English copy expectations for every force-delete branch).
import { describe, expect, test } from "vitest";
import {
  getDeleteWorktreeToastCopy,
  isLockedWorktreeRemovalError,
  isProvenLivePtyRemovalError,
} from "./delete-worktree-toast";

describe("getDeleteWorktreeToastCopy", () => {
  test("generic failure is destructive and echoes the error", () => {
    expect(getDeleteWorktreeToastCopy("demo", null, "boom")).toEqual({
      title: "Failed to delete workspace demo",
      description: "boom",
      isDestructive: true,
    });
  });

  test("locked failure without a reason names the unlock command", () => {
    const copy = getDeleteWorktreeToastCopy(
      "demo",
      null,
      "cannot remove a locked working tree",
    );
    expect(copy.title).toBe("Failed to delete workspace demo");
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
    expect(
      getDeleteWorktreeToastCopy("demo", "missing-registration", "gone").description,
    ).toContain("Use Force Delete");
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
});
