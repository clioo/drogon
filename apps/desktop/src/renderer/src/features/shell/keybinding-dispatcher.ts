// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference:
//   src/renderer/src/app-shell/use-global-keybindings.ts
//   src/renderer/src/components/terminal-workspace-keydown.ts
// Adapted to Drogon's shell callbacks and the shared registry. Terminal-owned
// chords are deliberately left to xterm/browser/editor listeners; this file
// only claims actions with a shell handler.
import {
  contextFromTarget,
  createKeybindingRegistry,
  isEditableTarget,
  isPaletteOpen,
  resolveKeybindingPlatform,
  shouldDispatch,
  type KeybindingPlatform,
  type KeybindingContext,
  type RegistryMatch,
} from "../../../../shared/keybindings";

export type ShellKeybindingInput = Pick<
  KeyboardEvent,
  "key" | "altKey" | "metaKey" | "ctrlKey" | "shiftKey" | "target" | "repeat"
>;

export type ShellKeybindingHandler = (
  digitIndex: number | null,
  event: KeyboardEvent,
) => void;

export type ShellKeybindingHandlers = Readonly<
  Record<string, ShellKeybindingHandler | undefined>
>;

export interface ShellKeybindingDispatchOptions {
  event: KeyboardEvent;
  handlers: ShellKeybindingHandlers;
  platform?: KeybindingPlatform;
  context?: KeybindingContext;
  editableTarget?: boolean;
  paletteOpen?: boolean;
}

/**
 * Match and dispatch one shell keydown using the source's exact modifier and
 * scope rules. Returns the registry match only when a handler claimed it.
 * Repeats are ignored: creation, close and navigation actions are keypresses,
 * never hold-to-repeat operations.
 */
export function dispatchShellKeybinding(
  options: ShellKeybindingDispatchOptions,
): RegistryMatch | null {
  const {
    event,
    handlers,
    platform = resolveKeybindingPlatform(
      typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")
        ? "darwin"
        : "other",
    ),
  } = options;
  if (event.repeat || event.defaultPrevented) return null;
  const context = options.context ?? contextFromTarget(event.target);
  const editableTarget =
    options.editableTarget ?? isEditableTarget(event.target);
  const registry = createKeybindingRegistry();
  const match = registry.match(
    {
      key: event.key,
      altKey: event.altKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
    },
    platform,
    context,
    {
      editableTarget,
      preferredScopes: context === "terminal" ? ["terminal"] : undefined,
    },
  );
  if (!match) return null;
  const handler = handlers[match.id];
  if (!handler) return null;

  // The fork's terminal workspace handler intentionally yields Cmd/Ctrl+W
  // (and tab rename) to the focused TUI. A shell close handler must not turn
  // those keystrokes into a tab close before xterm can consume them.
  if (
    context === "terminal" &&
    (match.id === "tab.close" || match.id === "tab.rename")
  ) {
    return null;
  }

  const definition = registry.definitions.find((item) => item.id === match.id);
  if (
    !shouldDispatch({
      id: match.id,
      scope: definition?.scope ?? "global",
      paletteOpen: options.paletteOpen ?? isPaletteOpen(),
      context,
      editableTarget,
    })
  ) {
    return null;
  }

  event.preventDefault();
  handler(match.digitIndex, event);
  return match;
}

export { contextFromTarget, isEditableTarget, resolveKeybindingPlatform };
