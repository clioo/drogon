// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/commit/commit-shortcut.ts
// plus the platform half of lib/screen-submit-shortcut.ts (fixed platform
// convention: Cmd+Enter on macOS, Ctrl+Enter elsewhere; never the user's
// configurable keybindings).
import type React from "react";

export function getCommitSubmitModifierLabel(): string {
  return resolveCommitSubmitPlatform() === "darwin" ? "⌘" : "Ctrl";
}

function resolveCommitSubmitPlatform(): "darwin" | "other" {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")
    ? "darwin"
    : "other";
}

export function isCommitSubmitShortcut(event: {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): boolean {
  if (event.key !== "Enter" || event.altKey || event.shiftKey) {
    return false;
  }
  // Why: screen submit is form-local behavior, so it stays fixed to the
  // platform convention instead of reading user-configurable app keybindings.
  return resolveCommitSubmitPlatform() === "darwin"
    ? Boolean(event.metaKey) && !event.ctrlKey
    : Boolean(event.ctrlKey) && !event.metaKey;
}

export function handleSourceControlCommitShortcut(
  event: React.KeyboardEvent<HTMLElement>,
  primaryAction: { disabled: boolean; kind: string },
  onCommit: () => void,
): void {
  if (primaryAction.disabled || primaryAction.kind !== "commit" || !isCommitSubmitShortcut(event)) {
    return;
  }
  // Why: the handler lives on the Source Control root, so the shortcut cannot fire from the editor, terminal, or another sidebar tab.
  event.preventDefault();
  event.stopPropagation();
  onCommit();
}
