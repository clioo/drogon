// clioo/drogon#315: pins the editor save transform to BYTE fidelity — the
// draft the model holds is the exact string the file bridge receives, for
// whole-document replacements, mid-file edits, files with and without a
// trailing newline, CRLF files and empty files. Root-cause context: QA saw
// a "stray trailing character" after select-all + type + save; the
// investigation proved the save path was never the problem (it writes the
// model verbatim, like the fork) — the extra bytes came from Monaco's own
// editing features (auto-close pairs, auto-surround of the selection,
// async auto-indent) transforming injected keystrokes, exactly as they do
// in the fork (both ship monaco-editor 0.55.1 with default editor options).
// These tests guard the layer that must stay identity.
import { describe, expect, test, vi } from "vitest";
import type { editor } from "monaco-editor";
import { makeFileSaver, createRequestIdSource } from "./file-read-write";
import { scopedFileKey, type EditorScope } from "./EditorPane";
import { syncContentUpdate } from "./monaco-content-sync";
import type { FileBridge } from "../../../../shared/file-contract";

const SCOPE: EditorScope = { hostId: "h1", workspaceId: "w1" };

/** Bridge that records the exact content string each fileWrite receives. */
function recordingBridge(writes: { path: string; content: string }[]): FileBridge {
  return {
    fileList: () => Promise.reject(new Error("unused")),
    fileRead: () => Promise.reject(new Error("unused")),
    fileWrite: (input) => {
      writes.push({ path: input.path, content: input.content });
      return Promise.resolve({
        ok: true,
        result: {
          hostId: input.hostId,
          workspaceId: input.workspaceId,
          path: input.path,
          size: new TextEncoder().encode(input.content).length,
          mtime: "t",
        },
      });
    },
  };
}

// The full matrix QA called out in #315. Each draft is what the Monaco
// model holds after the user's edit; the saved file must be exactly these
// bytes — nothing appended (no "helpful" final newline), nothing stripped,
// no EOL rewriting, no BOM, no trimming.
const BYTE_CASES: { name: string; path: string; draft: string }[] = [
  {
    name: "whole-document replacement without trailing newline",
    path: "index.html",
    draft: "<!DOCTYPE html>\n<html>\n</html>",
  },
  {
    name: "whole-document replacement with trailing newline",
    path: "index.html",
    draft: "<!DOCTYPE html>\n<html>\n</html>\n",
  },
  {
    name: "mid-file edit leaves surrounding bytes untouched",
    path: "app.ts",
    draft: "const a = 1;\nconst replaced = true;\nexport {}\n",
  },
  {
    name: "CRLF file keeps CRLF and gains no extra byte",
    path: "crlf.txt",
    draft: "line1\r\nline2\r\n",
  },
  {
    name: "single line without trailing newline",
    path: "note.txt",
    draft: "no trailing newline",
  },
  {
    name: "empty file saves as zero bytes",
    path: "empty.txt",
    draft: "",
  },
  {
    name: "unicode content is not re-encoded or trimmed",
    path: "uni.txt",
    draft: "héllo ☃\n",
  },
];

describe("save transform is byte-exact (clioo/drogon#315)", () => {
  for (const { name, path, draft } of BYTE_CASES) {
    test(name, async () => {
      const writes: { path: string; content: string }[] = [];
      const save = makeFileSaver(
        recordingBridge(writes),
        { hostId: SCOPE.hostId, workspaceId: SCOPE.workspaceId, path },
        createRequestIdSource(),
        scopedFileKey(SCOPE, path),
      );
      const result = await save(draft);
      expect(result.ok).toBe(true);
      expect(writes).toEqual([{ path, content: draft }]);
      // Byte-level identity, not just string equality (guards against any
      // future normalization that string comparison would miss).
      expect(new TextEncoder().encode(writes[0].content)).toEqual(
        new TextEncoder().encode(draft),
      );
    });
  }

  test("no save path layer appends a final newline", async () => {
    // The fork (orca-drogon) writes editorInstance.getValue() verbatim and
    // never inserts a final newline; the rewrite must match that. A draft
    // WITHOUT a trailing newline must reach the bridge byte-identical.
    const writes: { path: string; content: string }[] = [];
    const save = makeFileSaver(
      recordingBridge(writes),
      { hostId: SCOPE.hostId, workspaceId: SCOPE.workspaceId, path: "a.txt" },
      createRequestIdSource(),
      scopedFileKey(SCOPE, "a.txt"),
    );
    await save("exact");
    expect(writes[0].content).toBe("exact");
    expect(writes[0].content.endsWith("\n")).toBe(false);
  });
});

describe("model adoption normalization (fork parity: normalizeToModelEol)", () => {
  function harness(modelEol: string, initialContent: string) {
    const pushEditOperations = vi.fn();
    const model = {
      getValue: () => initialContent,
      getEOL: () => modelEol,
      getFullModelRange: () => ({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 2,
        endColumn: 1,
      }),
      pushEditOperations,
    } as unknown as editor.ITextModel;
    const editorInstance = {
      getModel: () => model,
      pushUndoStop: vi.fn(),
    } as unknown as editor.IStandaloneCodeEditor;
    return { editorInstance, pushEditOperations };
  }

  const pushedText = (pushEditOperations: ReturnType<typeof vi.fn>) =>
    pushEditOperations.mock.calls[0][1][0].text as string;

  test("LF model + LF content: verbatim", () => {
    const { editorInstance, pushEditOperations } = harness("\n", "stale\n");
    syncContentUpdate(editorInstance, "fresh\n");
    expect(pushedText(pushEditOperations)).toBe("fresh\n");
  });

  test("CRLF model adopts LF-flavored external content as CRLF (Monaco can only retain model EOL)", () => {
    const { editorInstance, pushEditOperations } = harness("\r\n", "stale\r\n");
    syncContentUpdate(editorInstance, "fresh\nnext\n");
    expect(pushedText(pushEditOperations)).toBe("fresh\r\nnext\r\n");
  });

  test("CRLF model keeps CRLF content byte-identical", () => {
    const { editorInstance, pushEditOperations } = harness("\r\n", "stale\r\n");
    syncContentUpdate(editorInstance, "fresh\r\n");
    expect(pushedText(pushEditOperations)).toBe("fresh\r\n");
  });

  test("content with no line endings is never touched", () => {
    const { editorInstance, pushEditOperations } = harness("\r\n", "stale");
    syncContentUpdate(editorInstance, "fresh");
    expect(pushedText(pushEditOperations)).toBe("fresh");
  });
});
