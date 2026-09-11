// MIT Copyright (c) 2026 Lovecast Inc.
// Unit tests for the empty state's honest directory classification: the
// missing / empty / files / unreadable / unknown situations must be
// distinguishable, invalid recipes must carry filename + reason, and the
// copy must blame the workspace (or the host) exactly as observed.

import { describe, expect, it } from "vitest";
import assert from "node:assert/strict";
import type { FileBridge, FileListResult } from "../../../../shared/file-contract";
import type { Result } from "../../../../shared/session-contract";
import type { MentuRecipeSummary } from "../../../../shared/mentu-contract";
import {
  describeMentuRecipeDirectory,
  invalidMentuRecipes,
  mentuRuntimeNote,
  probeMentuRecipeDirectory,
  probeNestedMentuRecipes,
} from "./recipe-directory-state";

function listBridge(result: Result<FileListResult>): FileBridge {
  return {
    fileList: async () => result,
  } as unknown as FileBridge;
}

function summary(overrides: Partial<MentuRecipeSummary> = {}): MentuRecipeSummary {
  return {
    id: "demo.json",
    path: ".mentu/recipes/demo.json",
    name: "demo",
    valid: true,
    issue: null,
    ...overrides,
  };
}

describe("probeMentuRecipeDirectory", () => {
  const input = { hostId: "host", workspaceId: "ws" };

  it("reports missing when the daemon lookup fails with not found", async () => {
    const status = await probeMentuRecipeDirectory(
      listBridge({
        ok: false,
        error: { code: "not_found", message: "directory not found", retryable: false },
      }),
      input,
    );
    expect(status).toEqual({ kind: "missing" });
  });

  it("reports empty for a present directory with no entries", async () => {
    const status = await probeMentuRecipeDirectory(
      listBridge({
        ok: true,
        result: {
          hostId: "host",
          workspaceId: "ws",
          path: ".mentu/recipes",
          entries: [],
          truncated: false,
        },
      }),
      input,
    );
    expect(status).toEqual({ kind: "empty" });
  });

  it("reports empty for a directory holding only subdirectories", async () => {
    const status = await probeMentuRecipeDirectory(
      listBridge({
        ok: true,
        result: {
          hostId: "host",
          workspaceId: "ws",
          path: ".mentu/recipes",
          entries: [{ name: "nested", kind: "directory", size: 0, mtime: "" }],
          truncated: false,
        },
      }),
      input,
    );
    expect(status).toEqual({ kind: "empty" });
  });

  it("counts files but not directories", async () => {
    const status = await probeMentuRecipeDirectory(
      listBridge({
        ok: true,
        result: {
          hostId: "host",
          workspaceId: "ws",
          path: ".mentu/recipes",
          entries: [
            { name: "a.json", kind: "file", size: 1, mtime: "" },
            { name: "nested", kind: "directory", size: 0, mtime: "" },
          ],
          truncated: false,
        },
      }),
      input,
    );
    expect(status).toEqual({ kind: "present", fileCount: 1 });
  });

  it("keeps the daemon's reason for any other read failure", async () => {
    const status = await probeMentuRecipeDirectory(
      listBridge({
        ok: false,
        error: { code: "invalid_argument", message: "path is not a directory", retryable: false },
      }),
      input,
    );
    expect(status).toEqual({ kind: "failed", reason: "path is not a directory" });
  });

  it("stays unknown without a bridge or a host, never guessing", async () => {
    expect(await probeMentuRecipeDirectory(null, input)).toEqual({ kind: "unknown" });
    expect(
      await probeMentuRecipeDirectory(listBridge({ ok: true } as Result<FileListResult>), {
        hostId: null,
        workspaceId: "ws",
      }),
    ).toEqual({ kind: "unknown" });
  });
});

describe("invalidMentuRecipes", () => {
  it("lists every refused file with its filename and reason", () => {
    const invalid = invalidMentuRecipes([
      summary(),
      summary({
        id: "broken.json",
        path: ".mentu/recipes/broken.json",
        valid: false,
        name: null,
        issue: "Invalid JSON: unexpected token",
      }),
      summary({
        id: "thin.json",
        path: ".mentu/recipes/thin.json",
        valid: false,
        name: null,
        issue: null,
      }),
    ]);
    expect(invalid).toEqual([
      {
        id: "broken.json",
        path: ".mentu/recipes/broken.json",
        issue: "Invalid JSON: unexpected token",
      },
      {
        id: "thin.json",
        path: ".mentu/recipes/thin.json",
        issue: "Recipe is missing \"name\" or \"steps\".",
      },
    ]);
  });
});

describe("probeNestedMentuRecipes", () => {
  const input = { hostId: "host", workspaceId: "ws" };

  /** A files bridge whose answers are keyed by the queried path. */
  function walkBridge(
    answers: Record<string, { name: string; kind: "file" | "directory" }[]>,
  ): FileBridge {
    return {
      fileList: async (input: { path: string }) => {
        const key = input.path.replace(/^\/+|\/+$/g, "");
        if (!(key in answers)) {
          return {
            ok: false,
            error: { code: "not_found", message: "directory not found", retryable: false },
          };
        }
        return {
          ok: true,
          result: {
            hostId: "host",
            workspaceId: "ws",
            path: key,
            entries: answers[key].map((e) => ({
              ...e,
              size: 1,
              mtime: "",
            })),
            truncated: false,
          },
        };
      },
    } as unknown as FileBridge;
  }

  it("finds recipe directories one level down and reports provenance", async () => {
    const findings = await probeNestedMentuRecipes(
      walkBridge({
        "": [
          { name: "mentu-recipes", kind: "directory" },
          { name: "README.md", kind: "file" },
        ],
        "mentu-recipes/.mentu/recipes": [
          { name: "demo-tareas.json", kind: "file" },
          { name: "claude-smoke.json", kind: "file" },
          { name: "notes.txt", kind: "file" },
        ],
      }),
      input,
    );
    assert.deepEqual(findings, [
      {
        relativeDir: "mentu-recipes/.mentu/recipes",
        total: 2,
        fileNames: ["demo-tareas.json", "claude-smoke.json"],
      },
    ]);
  });

  it("skips dependency/build/tool directories and hidden dirs", async () => {
    const findings = await probeNestedMentuRecipes(
      walkBridge({
        "": [
          { name: "node_modules", kind: "directory" },
          { name: "target", kind: "directory" },
          { name: ".hidden", kind: "directory" },
          { name: "subproject", kind: "directory" },
        ],
        "subproject/.mentu/recipes": [
          { name: "ok.json", kind: "file" },
        ],
      }),
      input,
    );
    // Only `subproject` was probed: the answer map has no answers for the
    // skipped candidates, so reaching them would have failed the test.
    assert.equal(findings.length, 1);
    assert.equal(findings[0].relativeDir, "subproject/.mentu/recipes");
  });

  it("returns nothing without a bridge or a host", async () => {
    assert.deepEqual(await probeNestedMentuRecipes(null, input), []);
    assert.deepEqual(
      await probeNestedMentuRecipes(walkBridge({}), { hostId: null, workspaceId: "ws" }),
      [],
    );
  });

  it("reports nothing when no candidate subproject carries recipes", async () => {
    const findings = await probeNestedMentuRecipes(
      walkBridge({
        "": [{ name: "plain", kind: "directory" }],
      }),
      input,
    );
    assert.deepEqual(findings, []);
  });
});

describe("mentuRuntimeNote", () => {
  it("stays null when the runtime is fine or simply unknown", () => {
    expect(mentuRuntimeNote(null)).toBeNull();
    expect(mentuRuntimeNote(undefined)).toBeNull();
    expect(
      mentuRuntimeNote({
        available: true,
        lockMatches: true,
        actualSha256: "abc",
        message: null,
      }),
    ).toBeNull();
  });

  it("blames the host, never the workspace, when nothing is installed", () => {
    const note = mentuRuntimeNote({
      available: false,
      lockMatches: false,
      actualSha256: null,
      message: "No Mentu runtime is installed for this data directory.",
    });
    expect(note).toContain("not installed on this host");
    expect(note).toContain("not a problem with this workspace");
    expect(note).toContain("No Mentu runtime is installed for this data directory.");
  });

  it("distinguishes a lock mismatch from a missing install", () => {
    const note = mentuRuntimeNote({
      available: false,
      lockMatches: false,
      actualSha256: "abc",
      message: "wrong bytes",
    });
    expect(note).toContain("does not match the approved runtime lock");
    expect(note).toContain("wrong bytes");
    expect(note).not.toContain("not installed on this host");
  });
});

describe("describeMentuRecipeDirectory", () => {
  it("points at selection when a valid recipe exists", () => {
    expect(
      describeMentuRecipeDirectory({ kind: "present", fileCount: 2 }, [summary()]),
    ).toBe("Select a recipe above to view its graph here.");
  });

  it("distinguishes missing from empty from present-but-invalid", () => {
    expect(describeMentuRecipeDirectory({ kind: "missing" }, [])).toBe(
      "No .mentu/recipes directory yet — this workspace has never had a recipe.",
    );
    expect(describeMentuRecipeDirectory({ kind: "empty" }, [])).toBe(
      "The .mentu/recipes directory exists but holds no recipe files.",
    );
    expect(
      describeMentuRecipeDirectory({ kind: "present", fileCount: 3 }, []),
    ).toBe(
      "The .mentu/recipes directory holds 3 files and none of them is a valid recipe.",
    );
  });

  it("surfaces read failures and the degraded unknown case verbatim", () => {
    expect(
      describeMentuRecipeDirectory(
        { kind: "failed", reason: "path is not a directory" },
        [],
      ),
    ).toBe(
      "The .mentu/recipes directory could not be read: path is not a directory",
    );
    expect(describeMentuRecipeDirectory({ kind: "unknown" }, [])).toBe(
      "Select a valid workspace recipe to view its graph.",
    );
  });
});
