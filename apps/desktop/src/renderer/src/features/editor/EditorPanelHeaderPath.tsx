// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/editor/EditorPanelHeaderPath.tsx. Kept: the
// file-path button (click-to-copy) plus the "File path copied" toast with
// the source's 1500ms token-guarded reset. Dropped: the inline rename
// field, the right-click path menu (Rename / Copy Path / Copy Relative
// Path / Open Markdown Preview / Reveal in Finder) — every item needs a
// backend this build does not have (no rename IPC, no reveal IPC, preview
// lives outside the editor), so porting the menu would be dead chrome.
// The copy itself goes through `navigator.clipboard` (precedent:
// features/shell/WorktreeContextMenu.tsx), not the fork's
// `window.api.ui.writeClipboardText` IPC.
import { useCallback, useEffect, useRef, useState } from "react";

export function EditorPanelHeaderPath({
  pathLabel,
  pathTitle,
  copyText,
  copyToastLabel,
}: {
  pathLabel: string;
  pathTitle: string;
  copyText: string;
  copyToastLabel: string;
}): React.JSX.Element {
  const [copiedVisible, setCopiedVisible] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  // Why a callback ref on the wrapping div instead of a mount effect: the
  // clipboard write resolves asynchronously, and the toast reset timer
  // must never start on an unmounted panel (source comment, kept).
  const setRootRef = useCallback((node: HTMLDivElement | null) => {
    mountedRef.current = node !== null;
    if (!node && resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const onCopyPath = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(copyText);
    } catch {
      if (mountedRef.current) setCopiedVisible(false);
      return;
    }
    if (!mountedRef.current) return;
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    const token = setTimeout(() => {
      resetTimerRef.current = null;
      if (mountedRef.current) setCopiedVisible(false);
    }, 1500);
    resetTimerRef.current = token;
    setCopiedVisible(true);
  }, [copyText]);

  return (
    <div className="editor-header-text" ref={setRootRef}>
      <div className="editor-header-path-row">
        <button
          type="button"
          className="editor-header-path"
          onClick={() => void onCopyPath()}
          title={pathTitle}
        >
          {pathLabel}
        </button>
        <span
          className={`editor-header-copy-toast${copiedVisible ? " is-visible" : ""}`}
          aria-live="polite"
        >
          {copyToastLabel}
        </span>
      </div>
    </div>
  );
}
