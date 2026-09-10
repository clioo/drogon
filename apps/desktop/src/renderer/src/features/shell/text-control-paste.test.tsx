// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AddProjectDialog } from "./AddProjectDialog";
import {
  findTextControlPasteTarget,
  handleTextControlAppMenuPaste,
  isNonTextPasteSurface,
  pasteTextIntoTextControl,
} from "./text-control-paste";

afterEach(cleanup);

function focusInput(initial = ""): HTMLInputElement {
  document.body.innerHTML = "";
  const input = document.createElement("input");
  input.type = "text";
  input.value = initial;
  document.body.appendChild(input);
  input.focus();
  return input;
}

describe("findTextControlPasteTarget", () => {
  it("claims a focused text input", () => {
    const input = focusInput();
    expect(findTextControlPasteTarget(document.activeElement)).toBe(input);
  });
  it("claims a textarea", () => {
    document.body.innerHTML = "";
    const area = document.createElement("textarea");
    document.body.appendChild(area);
    area.focus();
    expect(findTextControlPasteTarget(document.activeElement)).toBe(area);
  });
  it("returns null with no text target focused", () => {
    document.body.innerHTML = "";
    document.body.focus?.();
    expect(
      findTextControlPasteTarget(document.activeElement),
    ).toBeNull();
  });
  it("skips disabled and readonly controls", () => {
    const input = focusInput();
    input.disabled = true;
    expect(findTextControlPasteTarget(input)).toBeNull();
    input.disabled = false;
    input.readOnly = true;
    expect(findTextControlPasteTarget(input)).toBeNull();
  });
  it("skips checkbox inputs", () => {
    document.body.innerHTML = "";
    const box = document.createElement("input");
    box.type = "checkbox";
    document.body.appendChild(box);
    box.focus();
    expect(findTextControlPasteTarget(document.activeElement)).toBeNull();
  });
});

describe("isNonTextPasteSurface", () => {
  it("marks xterm helper textareas as terminal-owned", () => {
    document.body.innerHTML = "";
    const helper = document.createElement("textarea");
    helper.className = "xterm-helper-textarea";
    document.body.appendChild(helper);
    expect(isNonTextPasteSurface(helper)).toBe(true);
    expect(findTextControlPasteTarget(helper)).toBeNull();
  });
  it("marks monaco subtrees as editor-owned", () => {
    document.body.innerHTML = "";
    const root = document.createElement("div");
    root.className = "monaco-editor";
    const area = document.createElement("textarea");
    root.appendChild(area);
    document.body.appendChild(root);
    expect(isNonTextPasteSurface(area)).toBe(true);
    expect(findTextControlPasteTarget(area)).toBeNull();
  });
});

describe("pasteTextIntoTextControl", () => {
  it("inserts at the caret and fires a paste input event", () => {
    const input = focusInput("/path/to");
    input.setSelectionRange(input.value.length, input.value.length);
    const seen: string[] = [];
    input.addEventListener("input", (event) =>
      seen.push((event as InputEvent).inputType),
    );
    return pasteTextIntoTextControl(input, "/repo").then((result) => {
      expect(result).toEqual({ status: "pasted", mode: "direct" });
      expect(input.value).toBe("/path/to/repo");
      expect(seen).toEqual(["insertFromPaste"]);
    });
  });
  it("replaces the current selection", () => {
    const input = focusInput("hello world");
    input.setSelectionRange(6, 11);
    return pasteTextIntoTextControl(input, "drogon").then(() => {
      expect(input.value).toBe("hello drogon");
    });
  });
  it("rejects empty and oversized payloads", async () => {
    const input = focusInput();
    await expect(pasteTextIntoTextControl(input, "")).resolves.toEqual({
      status: "rejected",
      reason: "empty",
    });
    await expect(
      pasteTextIntoTextControl(input, "x".repeat(16 * 1024 * 1024 + 1)),
    ).resolves.toEqual({ status: "rejected", reason: "too-large" });
    expect(input.value).toBe("");
  });
  it("chunks large payloads without splitting content", () => {
    const input = focusInput();
    const text = "ab-ç-😀-".repeat(20_000);
    return pasteTextIntoTextControl(input, text).then((result) => {
      expect(result).toEqual({ status: "pasted", mode: "chunked" });
      expect(input.value).toBe(text);
    });
  });
});

describe("handleTextControlAppMenuPaste", () => {
  it("pastes clipboard text into the focused input", async () => {
    const input = focusInput("/base/");
    input.setSelectionRange(input.value.length, input.value.length);
    const result = await handleTextControlAppMenuPaste({
      readClipboardText: async () => "repo",
    });
    expect(result).toEqual({ status: "pasted", mode: "direct" });
    expect(input.value).toBe("/base/repo");
  });
  it("leaves terminal surfaces alone for their own pipeline", async () => {
    document.body.innerHTML = "";
    const helper = document.createElement("textarea");
    helper.className = "xterm-helper-textarea";
    document.body.appendChild(helper);
    helper.focus();
    const readClipboardText = vi.fn(async () => "repo");
    const result = await handleTextControlAppMenuPaste({ readClipboardText });
    expect(result).toEqual({
      status: "ignored",
      reason: "non-text-surface",
    });
    expect(readClipboardText).not.toHaveBeenCalled();
  });
  it("reports clipboard failures instead of throwing", async () => {
    focusInput();
    const result = await handleTextControlAppMenuPaste({
      readClipboardText: async () => {
        throw new Error("denied");
      },
    });
    expect(result).toEqual({
      status: "rejected",
      reason: "clipboard-unavailable",
    });
  });
});

describe("Add Project dialog paste (manual-equivalent)", () => {
  const dialogProps = {
    disabled: false,
    onBrowse: async () => null,
    onSubmit: async () => null,
    onClose: vi.fn(),
  };
  it("pastes into the Folder or repository path input", async () => {
    render(<AddProjectDialog {...dialogProps} />);
    const pathInput = screen.getByLabelText(
      "Folder or repository path",
    ) as HTMLInputElement;
    pathInput.focus();
    const result = await handleTextControlAppMenuPaste({
      readClipboardText: async () => "/tmp/drogon",
    });
    expect(result.status).toBe("pasted");
    expect(pathInput.value).toBe("/tmp/drogon");
    // The React state follows the DOM edit, so submit enables.
    expect(
      (screen.getByRole("button", { name: "Add Project" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("pastes into the optional Name input", async () => {
    render(<AddProjectDialog {...dialogProps} />);
    const nameInput = screen.getByLabelText(/Name/) as HTMLInputElement;
    nameInput.focus();
    const result = await handleTextControlAppMenuPaste({
      readClipboardText: async () => "my-project",
    });
    expect(result.status).toBe("pasted");
    expect(nameInput.value).toBe("my-project");
  });
  it("disables spellcheck on identifier inputs", () => {
    render(<AddProjectDialog {...dialogProps} />);
    // Why: paths and project names are identifiers, not prose — red
    // underlines (and spelling suggestions) are noise, same as the
    // source's location/rename fields. (jsdom has no spellcheck IDL, so
    // assert the content attribute Chromium reads.)
    expect(
      (screen.getByLabelText("Folder or repository path") as HTMLInputElement).getAttribute(
        "spellcheck",
      ),
    ).toBe("false");
    expect(
      (screen.getByLabelText(/Name/) as HTMLInputElement).getAttribute("spellcheck"),
    ).toBe("false");
  });
});
