// @vitest-environment jsdom
// Fork-parity header chrome for the editor pane (R16-X2, fixes #195/#196):
// file-path button with copy toast, Edit/Changes toggle with a real
// git-diff surface, and the More-actions menu. Monaco is stubbed out —
// these tests prove the chrome and its wiring, not the editor itself.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { EditorPane, type EditorPaneProps } from "./EditorPane";
import type { ChangesLoadResult } from "./EditorChangesView";
import type { Result } from "../../../../shared/session-contract";

vi.mock("./MonacoFileEditor", () => ({
  MonacoFileEditor: () => <div data-testid="monaco-stub" />,
}));

vi.mock("../source-control/diff/DiffViewer", () => ({
  DiffViewer: (props: { original: string; modified: string }) => (
    <div
      data-testid="diff-stub"
      data-original={props.original}
      data-modified={props.modified}
    />
  ),
}));

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

const SCOPE = { hostId: "h1", workspaceId: "w1" };
const okSave = (): EditorPaneProps["onSave"] => () =>
  Promise.resolve({ ok: true, result: null });

function renderPane(
  overrides: Partial<EditorPaneProps> & { path: string },
): void {
  render(
    <EditorPane
      scope={SCOPE}
      content="saved body"
      onSave={okSave()}
      {...overrides}
    />,
  );
}

const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " line one",
  "-line two",
  "+line TWO",
  " line three",
].join("\n");

function mockClipboard(): { writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return { writeText };
}

describe("editor header path button", () => {
  it("renders the path as a copy button with a toast label", () => {
    renderPane({ path: "src/a.ts" });
    const button = screen.getByRole("button", { name: "src/a.ts" });
    expect(button.className).toContain("editor-header-path");
    expect(screen.getByText("File path copied")).not.toBeNull();
  });

  it("copies the path and shows the toast on click", async () => {
    const { writeText } = mockClipboard();
    renderPane({ path: "src/a.ts" });
    fireEvent.click(screen.getByRole("button", { name: "src/a.ts" }));
    expect(writeText).toHaveBeenCalledWith("src/a.ts");
    const toast = await screen.findByText("File path copied");
    expect(toast.className).toContain("is-visible");
  });
});

describe("editor header dirty signals", () => {
  it("enables Save when dirty, with no name suffix or status line", () => {
    renderPane({
      path: "src/a.ts",
      content: "saved body",
      restoredDraft: { draft: "my retained draft", lastSaved: "saved body" },
    });
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByText(/unsaved/i)).toBeNull();
  });

  it("disables Save when clean", () => {
    renderPane({ path: "src/a.ts" });
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("editor Edit/Changes toggle", () => {
  const loadChanges = (): Promise<ChangesLoadResult> =>
    Promise.resolve({ ok: true, diff: DIFF, truncated: false });

  it("is hidden without a changes loader", () => {
    renderPane({ path: "src/a.ts" });
    expect(screen.queryByRole("radio", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Changes" })).toBeNull();
  });

  it("shows Edit checked and switches to a reconstructed diff", async () => {
    renderPane({ path: "src/a.ts", loadChanges });
    expect(
      screen.getByRole("radio", { name: "Edit" }).getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Changes" }));
    const stub = await screen.findByTestId("diff-stub");
    expect(stub.getAttribute("data-original")).toBe(
      "line one\nline two\nline three",
    );
    expect(stub.getAttribute("data-modified")).toBe(
      "line one\nline TWO\nline three",
    );
    expect(screen.queryByTestId("monaco-stub")).toBeNull();
  });

  it("reports an empty diff honestly", async () => {
    renderPane({
      path: "src/a.ts",
      loadChanges: () => Promise.resolve({ ok: true, diff: "", truncated: false }),
    });
    fireEvent.click(screen.getByRole("radio", { name: "Changes" }));
    expect(
      await screen.findByText("No uncommitted changes for this file."),
    ).not.toBeNull();
  });

  it("reports a failed load with a way back to Edit", async () => {
    const failing = (): Promise<ChangesLoadResult> =>
      Promise.resolve({ ok: false, message: "not a git repository" });
    renderPane({ path: "src/a.ts", loadChanges: failing });
    fireEvent.click(screen.getByRole("radio", { name: "Changes" }));
    expect(await screen.findByText("not a git repository")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to Edit" }));
    expect(await screen.findByTestId("monaco-stub")).not.toBeNull();
  });
});

describe("editor More-actions menu", () => {
  const loadChanges = (): Promise<ChangesLoadResult> =>
    Promise.resolve({ ok: true, diff: "", truncated: false });

  async function openMenu(): Promise<void> {
    // Enter opens the Radix menu from the trigger (a bare click without a
    // pointerdown never reaches it under jsdom — same pattern as the
    // dropdown-menu component tests).
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), {
      key: "Enter",
    });
    await screen.findByRole("menuitemcheckbox", { name: "Word Wrap" });
  }

  it("toggles Word Wrap, checked by default like the fork", async () => {
    renderPane({ path: "src/a.ts", loadChanges });
    await openMenu();
    const item = screen.getByRole("menuitemcheckbox", { name: "Word Wrap" });
    expect(item.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(item);
    await openMenu();
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Word Wrap" }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("shows Show Whitespace only on the changes surface", async () => {
    renderPane({ path: "src/a.ts", loadChanges });
    await openMenu();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Show Whitespace" })).toBeNull();
    // The open menu is modal and swallows outside clicks: dismiss it
    // before driving the toggle underneath.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("radio", { name: "Changes" }));
    await screen.findByText("No uncommitted changes for this file.");
    await openMenu();
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Show Whitespace" }),
    ).not.toBeNull();
  });

  it("disables Export as PDF for markdown with the fork's copy", async () => {
    renderPane({ path: "notes.md", loadChanges });
    await openMenu();
    const item = screen.getByRole("menuitem", { name: "Export as PDF" });
    expect(item.getAttribute("aria-disabled")).toBe("true");
  });

  it("omits Export as PDF for non-markdown files", async () => {
    renderPane({ path: "src/a.ts", loadChanges });
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: "Export as PDF" })).toBeNull();
  });
});

describe("editor save contract", () => {
  it("still typechecks the Result contract used by the save pipeline", () => {
    const ok: Result<null> = { ok: true, result: null };
    expect(ok.ok).toBe(true);
  });
});
