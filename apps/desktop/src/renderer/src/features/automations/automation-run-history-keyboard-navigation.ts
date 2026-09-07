// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/automation-run-history-keyboard-navigation.ts.
// Literal port over run-id lists.
export type AutomationRunHistoryArrowKey = "ArrowUp" | "ArrowDown";

export function isAutomationRunHistoryArrowKey(
  key: string,
): key is AutomationRunHistoryArrowKey {
  return key === "ArrowUp" || key === "ArrowDown";
}

export function shouldHandleAutomationRunHistoryKey(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  nativeEvent?: { isComposing?: boolean };
  target?: EventTarget | null;
}): boolean {
  if (
    (!isAutomationRunHistoryArrowKey(event.key) && event.key !== "Enter") ||
    Boolean(event.nativeEvent?.isComposing) ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return false;
  }

  const target = event.target;
  if (target instanceof HTMLElement) {
    if (
      target.isContentEditable ||
      target.matches(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]',
      )
    ) {
      return false;
    }
    if (target.closest('[role="dialog"], [role="menu"], [role="listbox"]')) {
      return false;
    }
  }

  return true;
}

export function getAutomationRunHistoryArrowTarget<T extends { id: string }>(args: {
  runs: readonly T[];
  selectedRunId: string | null;
  key: AutomationRunHistoryArrowKey;
}): T | null {
  const { runs, selectedRunId, key } = args;
  if (runs.length === 0) {
    return null;
  }
  const currentIndex =
    selectedRunId === null
      ? -1
      : runs.findIndex((run) => run.id === selectedRunId);
  if (currentIndex < 0) {
    return runs[key === "ArrowDown" ? 0 : runs.length - 1] ?? null;
  }
  const nextIndex = key === "ArrowDown" ? currentIndex + 1 : currentIndex - 1;
  if (nextIndex < 0 || nextIndex >= runs.length) {
    return runs[currentIndex] ?? null;
  }
  return runs[nextIndex] ?? null;
}
