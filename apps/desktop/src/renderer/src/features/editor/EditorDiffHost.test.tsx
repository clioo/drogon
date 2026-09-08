// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc. R16-BJ (#294): the editor diff tab
// surface. Monaco is stubbed; these tests prove the fork's diff-surface
// header (side-by-side toggle, Previous/Next change, More actions with
// Word Wrap + Show Whitespace, Close), the loading/ready/error states and
// the staged/unstaged data-layer call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { EditorDiffHost } from "./EditorDiffHost";

let gitDiffCalls: Array<{ path: string; staged: boolean }>;
let gitDiffReply: () => Promise<{
  ok: boolean;
  result?: { diff: string; truncated: boolean };
  error?: { code: string; message: string };
}>;

vi.mock("../../changes-mount", () => ({
  windowGitBridge: () => ({
    gitDiff: (input: { path: string; staged: boolean }) => {
      gitDiffCalls.push(input);
      return gitDiffReply();
    },
  }),
}));

vi.mock("../source-control/diff/DiffViewer", () => ({
  DiffViewer: (props: { original: string; modified: string; path: string }) => (
    <div
      data-testid="diff-stub"
      data-original={props.original}
      data-modified={props.modified}
      data-path={props.path}
    />
  ),
}));

const READY = {
  ok: true as const,
  result: {
    diff:
      "diff --git a/notes.txt b/notes.txt\n--- a/notes.txt\n+++ b/notes.txt\n@@ -1,1 +1,2 @@\n one\n+two\n",
    truncated: false,
  },
};

beforeEach(() => {
  installRadixJsdomStubs();
  gitDiffCalls = [];
  gitDiffReply = () => Promise.resolve(READY);
});
afterEach(cleanup);

function renderHost(overrides?: { area?: "staged" | "unstaged"; onClose?: () => void }) {
  return render(
    <EditorDiffHost
      scope={{ hostId: "host-1", workspaceId: "ws-1" }}
      path="notes.txt"
      area={overrides?.area ?? "unstaged"}
      onClose={overrides?.onClose}
    />,
  );
}

describe("editor diff host (#294)", () => {
  it("loads the diff through gitDiff with the tab's area", async () => {
    renderHost({ area: "staged" });
    await waitFor(() =>
      expect(gitDiffCalls).toEqual([
        { hostId: "host-1", workspaceId: "ws-1", path: "notes.txt", staged: true },
      ]),
    );
    expect(await screen.findByTestId("diff-stub")).toBeTruthy();
  });

  it("renders the reconstructed original/modified panes", async () => {
    renderHost();
    const stub = await screen.findByTestId("diff-stub");
    expect(stub.getAttribute("data-path")).toBe("notes.txt");
    expect(stub.getAttribute("data-original")).toContain("one");
    expect(stub.getAttribute("data-modified")).toContain("two");
  });

  it("carries the fork's diff header: toggle, prev/next, More actions, Close", async () => {
    const onClose = vi.fn();
    renderHost({ onClose });
    await screen.findByTestId("diff-stub");

    // Default is side-by-side, so the fork's tooltip/aria copy offers the
    // inline switch.
    expect(
      screen.getByRole("button", { name: "Switch to inline diff" }),
    ).toBeTruthy();

    const previous = screen.getByRole("button", { name: "Previous change" });
    const next = screen.getByRole("button", { name: "Next change" });
    // No Monaco mount: zero registered changes, so the nav disables —
    // fork parity (disabled, not hidden, when the diff has no changes).
    expect(previous.getAttribute("disabled")).not.toBeNull();
    expect(next.getAttribute("disabled")).not.toBeNull();

    // jsdom/Radix: the menu opens on keyboard activation (the pane's own
    // header tests use the same discipline).
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), {
      key: "Enter",
    });
    expect(
      await screen.findByRole("menuitemcheckbox", { name: "Word Wrap" }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("menuitemcheckbox", { name: "Show Whitespace" }),
    ).toBeTruthy();
    // The open menu is modal and swallows outside clicks: dismiss it
    // before driving the Close button underneath (pane test discipline).
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("marks the loading state and labels the surface with the file", async () => {
    gitDiffReply = () => new Promise(() => {}); // pending
    renderHost();
    expect(screen.getByLabelText("Diff: notes.txt")).toBeTruthy();
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Loading diff");
    expect(gitDiffCalls).toEqual([
      { hostId: "host-1", workspaceId: "ws-1", path: "notes.txt", staged: false },
    ]);
  });

  it("shows the load-failure card with Retry on an error result", async () => {
    gitDiffReply = () =>
      Promise.resolve({ ok: false, error: { code: "io_error", message: "git diff exploded" } });
    renderHost();
    const card = await screen.findByText("Unable to load file");
    expect(card.textContent).toBe("Unable to load file");
    expect(screen.getByText("git diff exploded")).toBeTruthy();

    // Retry re-requests the same load and recovers.
    gitDiffReply = () => Promise.resolve(READY);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("diff-stub")).toBeTruthy();
  });

  it("reports no diff for a clean file instead of an empty editor", async () => {
    gitDiffReply = () => Promise.resolve({ ok: true, result: { diff: "", truncated: false } });
    renderHost();
    expect(await screen.findByText("No diff for this file.")).toBeTruthy();
  });
});
