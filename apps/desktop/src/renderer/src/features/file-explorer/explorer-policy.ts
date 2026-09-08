/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/file-explorer-row-action-visibility.ts
   (item visibility), useFileDeletion.ts (confirmation copy) and
   shared/keybindings/definitions-core-3.ts (delete chord defaults).
   Adapted: the daemon deletes permanently on local workspaces too, so the
   local delete uses the source's REMOTE (permanent) copy rather than the
   Trash copy; download/browser/duplicate/find-in-folder actions are out of
   MVP scope and never appear. */

import type { ExplorerNode } from "./tree-model";

/**
 * Rename shortcut label: ↩ on macOS, Enter elsewhere (source
 * `file-explorer-row-context-menu.tsx`: `isMac ? '↩' : 'Enter'`).
 */
export function renameShortcutLabel(platform?: string): string {
  const userAgent =
    platform ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return userAgent.includes("Mac") ? "↩" : "Enter";
}

/** Delete chord label: ⌘⌫ on macOS, Delete elsewhere (source defaults). */
export function deleteShortcutLabel(platform?: string): string {
  const userAgent =
    platform ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return userAgent.includes("Mac") ? "⌘⌫" : "Delete";
}

export type ExplorerCapabilities = {
  /** Daemon mutation methods are exposed (files.create/rename/delete). */
  canMutate: boolean;
  /** Reason shown when mutation UI is disabled. */
  mutateDisabledReason?: string;
  /** Reveal uses no shell bridge in this repo (see FileExplorerMenus). */
  canReveal: boolean;
  /** Open in Terminal spawns through the existing session bridge. */
  canOpenTerminal: boolean;
};

export type RowMenuItemId =
  | "new-file"
  | "new-folder"
  | "copy-path"
  | "copy-relative-path"
  | "open-in-terminal"
  | "reveal-in-finder"
  | "rename"
  | "delete";

export interface RowMenuItem {
  id: RowMenuItemId;
  label: string;
  shortcut?: string;
  destructive?: boolean;
  separatorBefore?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

/** Platform-appropriate reveal label (source copy). */
export function revealLabel(platform?: string): string {
  const userAgent =
    platform ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (userAgent.includes("Mac")) return "Reveal in Finder";
  if (userAgent.includes("Linux")) return "Open Containing Folder";
  return "Reveal in File Explorer";
}

/**
 * Row context-menu model in source order (MVP subset): New File, New
 * Folder, Copy Path, Copy Relative Path, Open in Terminal (directories
 * only), Reveal in Finder, Rename, Delete. Mutation items disable (never
 * hide) when the bridge lacks the methods, so the menu shape stays stable.
 */
export function buildRowMenuItems(
  node: ExplorerNode,
  selectionSize: number,
  caps: ExplorerCapabilities,
): RowMenuItem[] {
  const mutateDisabled = caps.canMutate
    ? {}
    : {
        disabled: true,
        disabledReason:
          caps.mutateDisabledReason ??
          "File changes need a newer daemon with files.create support.",
      };
  return [
    { id: "new-file", label: "New File", ...mutateDisabled },
    { id: "new-folder", label: "New Folder", ...mutateDisabled },
    {
      id: "copy-path",
      label: selectionSize > 1 ? "Copy Paths" : "Copy Path",
      separatorBefore: true,
    },
    {
      id: "copy-relative-path",
      label:
        selectionSize > 1 ? "Copy Relative Paths" : "Copy Relative Path",
    },
    ...(node.isDirectory && caps.canOpenTerminal
      ? [{ id: "open-in-terminal", label: "Open in Terminal" } as RowMenuItem]
      : []),
    // No shell bridge exists in this repo: the item stays visible but
    // disabled with its reason, never a dead click and never hidden.
    {
      id: "reveal-in-finder",
      label: revealLabel(),
      ...(caps.canReveal
        ? {}
        : {
            disabled: true as const,
            disabledReason: "Reveal in Finder needs the shell bridge, which is not wired in this build.",
          }),
    },
    {
      id: "rename",
      label: "Rename",
      separatorBefore: true,
      shortcut: renameShortcutLabel(),
      ...mutateDisabled,
    },
    {
      id: "delete",
      label: "Delete",
      destructive: true,
      shortcut: deleteShortcutLabel(),
      ...mutateDisabled,
    },
  ];
}

/** Background (empty-area) menu: New File, New Folder. */
export function buildBackgroundMenuItems(
  caps: ExplorerCapabilities,
): Pick<RowMenuItem, "id" | "label" | "disabled" | "disabledReason">[] {
  const mutateDisabled = caps.canMutate
    ? {}
    : {
        disabled: true as const,
        disabledReason:
          caps.mutateDisabledReason ??
          "File changes need a newer daemon with files.create support.",
      };
  return [
    { id: "new-file", label: "New File", ...mutateDisabled },
    { id: "new-folder", label: "New Folder", ...mutateDisabled },
  ];
}

export interface DeleteConfirmation {
  title: string;
  description: string;
  confirmLabel: string;
}

/**
 * Delete confirmation copy. The source confirms only permanent (remote)
 * deletes; local ones go to Trash prompt-free. This daemon deletes
 * permanently on local workspaces too, so the permanent copy applies to
 * every delete here.
 */
export function deleteConfirmationFor(
  nodes: readonly ExplorerNode[],
): DeleteConfirmation {
  if (nodes.length > 1) {
    return {
      title: `Permanently delete ${nodes.length} items?`,
      description:
        "This permanently deletes the selected items and any directory contents. This cannot be undone.",
      confirmLabel: "Delete",
    };
  }
  const node = nodes[0];
  return {
    title: `Permanently delete '${node.name}'?`,
    description: node.isDirectory
      ? "This permanently deletes the directory and its contents. This cannot be undone."
      : "This permanently deletes the file. This cannot be undone.",
    confirmLabel: "Delete",
  };
}

export type InlineKind = "file" | "folder" | "rename";

export type InlineValidation =
  | { ok: true; unchanged: boolean }
  | { ok: false; error: string };

/**
 * Inline name state machine guard: Enter submits through here before any
 * bridge call. `existingName` is set for renames (unchanged names cancel);
 * `siblings` holds the names already present in the target directory.
 */
export function validateInlineName(
  rawValue: string,
  kind: InlineKind,
  siblings: ReadonlySet<string>,
  existingName?: string,
): InlineValidation {
  const name = rawValue.trim();
  if (name === "") return { ok: false, error: "Enter a name." };
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    return { ok: false, error: "A name cannot contain path separators." };
  }
  if (kind === "rename" && name === existingName) {
    return { ok: true, unchanged: true };
  }
  if (siblings.has(name)) {
    return { ok: false, error: "A file or folder with this name already exists." };
  }
  return { ok: true, unchanged: false };
}
