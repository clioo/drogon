// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc. Adapted from Orca's
// src/renderer/src/components/editor/diff-navigation-context.test.tsx: this
// repo's DOM tests use `@testing-library/react` + jsdom (not happy-dom), and
// the "installs a capture-phase key listener" case is dropped along with
// the F7 shortcut wiring it exercised (see diff-navigation-context.tsx).
import { act } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { editor } from "monaco-editor";
import {
  DiffNavigationProvider,
  useDiffEditorRegistration,
  useDiffNavigation,
  type DiffEditorRegistrationContextValue,
  type DiffNavigationContextValue,
} from "./diff-navigation-context";

type FakeDiffEditor = editor.IStandaloneDiffEditor & {
  setLineChanges: (count: number) => void;
  fireUpdate: () => void;
  goToDiff: ReturnType<typeof vi.fn>;
  disposeUpdate: ReturnType<typeof vi.fn>;
};

function createFakeEditor(initialCount: number): FakeDiffEditor {
  let count = initialCount;
  let updateCallback: (() => void) | null = null;
  const disposeUpdate = vi.fn(() => {
    updateCallback = null;
  });
  const fakeEditor = {
    getLineChanges: () =>
      count > 0 ? Array.from({ length: count }, () => ({})) : [],
    goToDiff: vi.fn(),
    onDidUpdateDiff: (cb: () => void) => {
      updateCallback = cb;
      return { dispose: disposeUpdate };
    },
    setLineChanges: (next: number) => {
      count = next;
    },
    fireUpdate: () => updateCallback?.(),
    disposeUpdate,
  } as unknown as FakeDiffEditor;
  return fakeEditor;
}

let captured: DiffNavigationContextValue | null = null;
let registration: DiffEditorRegistrationContextValue | null = null;
let registrationRenderCount = 0;

function Probe(): null {
  captured = useDiffNavigation();
  return null;
}

function RegistrationProbe(): null {
  registration = useDiffEditorRegistration();
  registrationRenderCount += 1;
  return null;
}

describe("DiffNavigationProvider", () => {
  function mount() {
    return render(
      <DiffNavigationProvider>
        <Probe />
        <RegistrationProbe />
      </DiffNavigationProvider>,
    );
  }

  afterEach(() => {
    cleanup();
    captured = null;
    registration = null;
    registrationRenderCount = 0;
  });

  it("exposes the change count and routes nav actions to the registered editor", () => {
    mount();
    const editorInstance = createFakeEditor(3);
    act(() => registration?.registerDiffEditor(editorInstance));

    expect(captured?.changeCount).toBe(3);

    act(() => captured?.goToNextDiff());
    expect(editorInstance.goToDiff).toHaveBeenCalledWith("next");

    act(() => captured?.goToPreviousDiff());
    expect(editorInstance.goToDiff).toHaveBeenCalledWith("previous");
  });

  it("re-renders when onDidUpdateDiff flips the count 0 -> N (count is state)", () => {
    mount();
    const editorInstance = createFakeEditor(0);
    act(() => registration?.registerDiffEditor(editorInstance));
    expect(captured?.changeCount).toBe(0);

    act(() => {
      editorInstance.setLineChanges(2);
      editorInstance.fireUpdate();
    });
    expect(captured?.changeCount).toBe(2);
    expect(registrationRenderCount).toBe(1);
  });

  it("ignores a stale unregister for an editor that is no longer current (identity guard)", () => {
    mount();
    const oldEditor = createFakeEditor(1);
    const newEditor = createFakeEditor(4);

    // Fast-swap: new editor registers before the old one's dispose fires.
    act(() => registration?.registerDiffEditor(oldEditor));
    act(() => registration?.registerDiffEditor(newEditor));
    expect(captured?.changeCount).toBe(4);
    expect(oldEditor.disposeUpdate).toHaveBeenCalledOnce();

    // A stale update from the old editor must not flip the count back: registering
    // the new editor disposed the old subscription, so its callback no longer fires.
    act(() => {
      oldEditor.setLineChanges(9);
      oldEditor.fireUpdate();
    });
    expect(captured?.changeCount).toBe(4);

    act(() => registration?.unregisterDiffEditor(oldEditor));

    // New editor's count is intact and nav still routes to it.
    expect(captured?.changeCount).toBe(4);
    act(() => captured?.goToNextDiff());
    expect(newEditor.goToDiff).toHaveBeenCalledWith("next");
    expect(oldEditor.goToDiff).not.toHaveBeenCalled();
  });

  it("disposes the active diff update subscription when the provider unmounts", () => {
    const view = mount();
    const editorInstance = createFakeEditor(1);
    act(() => registration?.registerDiffEditor(editorInstance));

    act(() => view.unmount());

    expect(editorInstance.disposeUpdate).toHaveBeenCalledOnce();
  });
});
