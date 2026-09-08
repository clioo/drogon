/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/lib/screen-submit-shortcut.ts (isScreenSubmitShortcut,
   getScreenSubmitModifierLabel) and
   src/renderer/src/lib/new-workspace-enter-guard.ts
   (shouldAllowComposerEnterSubmitTarget). Adapter: the platform check reads
   navigator instead of the source's shortcut-platform helper. */

type ScreenSubmitShortcutEvent = {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
};

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
}

export function isScreenSubmitShortcut(event: ScreenSubmitShortcutEvent): boolean {
  if (event.isComposing || event.nativeEvent?.isComposing) {
    return false;
  }
  if (event.key !== "Enter" || event.altKey || event.shiftKey) {
    return false;
  }
  // Why: screen submit is form-local behavior, so it stays fixed to the
  // platform convention instead of reading user-configurable app keybindings.
  return isMacPlatform()
    ? Boolean(event.metaKey) && !event.ctrlKey
    : Boolean(event.ctrlKey) && !event.metaKey;
}

export function getScreenSubmitModifierLabel(): string {
  return isMacPlatform() ? "\u2318" : "Ctrl";
}

export function shouldAllowComposerEnterSubmitTarget(
  target: EventTarget | null,
  composer: HTMLElement | null,
): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (composer?.contains(target)) {
    return true;
  }
  // Why: selecting a PR/issue/Linear row tears down the focused input and
  // Radix's focus restore can land on body/documentElement, the DialogContent
  // root, or any other ancestor wrapping the composer. Allow any ancestor so
  // the modal's Cmd/Ctrl+Enter shortcut keeps firing post-selection.
  return composer ? target.contains(composer) : false;
}

const WORKSPACE_NAME_INPUT_SELECTOR = '[data-workspace-name-input="true"]';
const PROJECT_COMBOBOX_TRIGGER_SELECTOR = '[data-project-combobox-root="true"][role="combobox"]';

/**
 * The source's getWorkspaceComposerInitialFocusTarget
 * (src/renderer/src/lib/workspace-composer-initial-focus.ts): most opens
 * already have a project selected; land on the name field so typing starts
 * immediately. The combobox fallback covers surfaces that omit the name
 * field.
 */
export function getWorkspaceComposerInitialFocusTarget(root: ParentNode): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>(WORKSPACE_NAME_INPUT_SELECTOR) ??
    root.querySelector<HTMLElement>(PROJECT_COMBOBOX_TRIGGER_SELECTOR)
  );
}
