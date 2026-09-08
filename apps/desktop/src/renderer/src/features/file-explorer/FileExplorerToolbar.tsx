/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/FileExplorerToolbar.tsx.
   Adapted: New File / New Folder / Reveal Active File buttons lead (the
   task's toolbar contract) ahead of Collapse All and Refresh; the overflow
   menu keeps Show Dotfiles and Show Git Ignored Files (git workspaces
   only, like the source's activeRepoSupportsGit gate) and drops Open-in
   destinations (user-configured editor apps — no Drogon settings yet) and
   search-view concerns (out of MVP scope). Tooltips are `title`
   attributes: this panel mounts outside any tooltip provider. */

import { useEffect, useRef, useState } from "react";
import { Check, FilePlus, FolderPlus, ListCollapse, Loader2, LocateFixed, MoreHorizontal, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";

export interface FileExplorerToolbarProps {
  repoName: string;
  canCreate: boolean;
  createDisabledReason?: string;
  onNewFile: () => void;
  onNewFolder: () => void;
  canRefresh: boolean;
  isRefreshing: boolean;
  showRefreshSpinner: boolean;
  onRefresh: () => void;
  canCollapseAll: boolean;
  onCollapseAll: () => void;
  canRevealActive: boolean;
  onRevealActive: () => void;
  showDotfiles: boolean;
  onToggleDotfiles: () => void;
  /** Source gate (activeRepoSupportsGit): the toggle exists for git repos. */
  showGitIgnoredFilesToggle?: boolean;
  showGitIgnoredFiles?: boolean;
  onToggleGitIgnoredFiles?: () => void;
}

function ToolbarButton({
  label,
  title,
  disabled,
  disabledReason,
  onClick,
  children,
}: {
  label: string;
  title?: string;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`h-6 w-6 text-muted-foreground hover:text-foreground ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      aria-label={label}
      title={disabled && disabledReason ? disabledReason : (title ?? label)}
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        // Native disabled buttons suppress hover titles; keep the button
        // enabled and refuse explicitly so the reason stays discoverable.
        if (disabled) {
          event.preventDefault();
          return;
        }
        onClick();
      }}
    >
      {children}
    </Button>
  );
}

export function FileExplorerToolbar({
  repoName,
  canCreate,
  createDisabledReason,
  onNewFile,
  onNewFolder,
  canRefresh,
  isRefreshing,
  showRefreshSpinner,
  onRefresh,
  canCollapseAll,
  onCollapseAll,
  canRevealActive,
  onRevealActive,
  showDotfiles,
  onToggleDotfiles,
  showGitIgnoredFilesToggle = false,
  showGitIgnoredFiles = true,
  onToggleGitIgnoredFiles,
}: FileExplorerToolbarProps) {
  return (
    <div className="flex h-8 min-h-8 items-center gap-2 border-b border-border px-2">
      <span
        className="min-w-0 flex-1 truncate text-xs font-medium text-foreground"
        title={repoName}
      >
        {repoName}
      </span>
      <ToolbarButton
        label="New File"
        disabled={!canCreate}
        disabledReason={createDisabledReason}
        onClick={onNewFile}
      >
        <FilePlus className="size-3" />
      </ToolbarButton>
      <ToolbarButton
        label="New Folder"
        disabled={!canCreate}
        disabledReason={createDisabledReason}
        onClick={onNewFolder}
      >
        <FolderPlus className="size-3" />
      </ToolbarButton>
      <ToolbarButton
        label="Reveal Active File"
        disabled={!canRevealActive}
        onClick={onRevealActive}
      >
        <LocateFixed className="size-3" />
      </ToolbarButton>
      <ToolbarButton
        label="Collapse All"
        disabled={!canCollapseAll}
        onClick={onCollapseAll}
      >
        <ListCollapse className="size-3" />
      </ToolbarButton>
      <ToolbarButton
        label="Refresh Explorer"
        disabled={!canRefresh || isRefreshing}
        onClick={onRefresh}
      >
        {showRefreshSpinner ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <RefreshCw className="size-3" />
        )}
      </ToolbarButton>
      <MoreExplorerActions
        showDotfiles={showDotfiles}
        onToggleDotfiles={onToggleDotfiles}
        showGitIgnoredFilesToggle={showGitIgnoredFilesToggle}
        showGitIgnoredFiles={showGitIgnoredFiles}
        onToggleGitIgnoredFiles={onToggleGitIgnoredFiles}
      />
    </div>
  );
}

function MoreExplorerActions({
  showDotfiles,
  onToggleDotfiles,
  showGitIgnoredFilesToggle,
  showGitIgnoredFiles,
  onToggleGitIgnoredFiles,
}: {
  showDotfiles: boolean;
  onToggleDotfiles: () => void;
  showGitIgnoredFilesToggle: boolean;
  showGitIgnoredFiles: boolean;
  onToggleGitIgnoredFiles?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open ]);
  return (
    <div className="relative" ref={menuRef}>
      <ToolbarButton
        label="More Explorer Actions"
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="size-3" />
      </ToolbarButton>
      {open && (
        <div
          role="menu"
          aria-label="More Explorer Actions"
          className="absolute right-0 top-7 z-20 min-w-[12rem] rounded-md border border-border bg-popover p-1 shadow-md"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={showDotfiles}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
            onClick={() => {
              onToggleDotfiles();
              setOpen(false);
            }}
          >
            <span className="size-3 shrink-0">
              {showDotfiles && <Check className="size-3" aria-hidden />}
            </span>
            Show Dotfiles
          </button>
          {showGitIgnoredFilesToggle && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={showGitIgnoredFiles}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
              onClick={() => {
                onToggleGitIgnoredFiles?.();
                setOpen(false);
              }}
            >
              <span className="size-3 shrink-0">
                {showGitIgnoredFiles && <Check className="size-3" aria-hidden />}
              </span>
              Show Git Ignored Files
            </button>
          )}
        </div>
      )}
    </div>
  );
}
