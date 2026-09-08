// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/listing/uncommitted-entry-row.tsx.
// Adapter: file-type icons come from lucide (no file-type icon catalog in
// this repo) tinted with the row's status color; conflict, submodule and
// review-note affordances have no MVP data and are not ported. Row identity
// (test id, data attrs) and the hover action overlay match the source; the
// row is a non-interactive div like the source (click opens the diff, the
// Discard/Stage buttons are the only tab stops) — no role=button wrapper.

import React from "react";
import { File, Minus, Plus, Trash, Undo2 } from "lucide-react";
import { basename, cn, dirname } from "./panel-class-names";
import type { SourceControlEntry } from "./source-control-entry";
import { STATUS_COLORS, STATUS_LABELS } from "./source-control-entry";
import { ActionButton } from "./action-button";
import { DiffLineCounts } from "./diff-line-counts";
import { SourceControlEntryContextMenu } from "./entry-context-menu";
import {
  canDiscardStatusEntry,
  canStageStatusEntry,
  canUnstageStatusEntry,
} from "./entry-actions";
import {
  SOURCE_CONTROL_ROW_ACTION_OVERLAY_CLASS,
  SOURCE_CONTROL_TREE_FILE_PADDING_PX,
  SOURCE_CONTROL_TREE_INDENT_PX,
} from "./row-layout";

/**
 * Renders one uncommitted change row: file identity, diff counts, status
 * letter, and the hover actions (discard, stage, unstage) that the entry's
 * own state permits. Clicking selects the row and opens its diff.
 */
export const UncommittedEntryRow = React.memo(function UncommittedEntryRow({
  entryKey,
  entry,
  depth = 0,
  selected,
  isOpenFile = false,
  onSelect,
  onContextMenu,
  onOpen,
  onStage,
  onUnstage,
  onDiscard,
  showPathHint = true,
}: {
  entryKey: string;
  entry: SourceControlEntry;
  depth?: number;
  selected?: boolean;
  isOpenFile?: boolean;
  onSelect?: (key: string) => void;
  onContextMenu?: (key: string) => void;
  onOpen: (entry: SourceControlEntry) => void;
  onStage: (filePath: string) => Promise<void>;
  onUnstage: (filePath: string) => Promise<void>;
  onDiscard: (entry: SourceControlEntry) => void;
  showPathHint?: boolean;
}): React.JSX.Element {
  const fileName = basename(entry.path);
  const parentDir = dirname(entry.path);
  const dirPath = parentDir === "." ? "" : parentDir;
  const canDiscard = canDiscardStatusEntry(entry);
  const canStage = canStageStatusEntry(entry);
  const canUnstage = canUnstageStatusEntry(entry);

  return (
    <SourceControlEntryContextMenu
      relativePath={entry.path}
      onView={() => onOpen(entry)}
      onOpenChange={(open) => {
        if (open && onContextMenu) {
          onContextMenu(entryKey);
        }
      }}
    >
      <div
        data-testid="source-control-entry"
        data-source-control-path={entry.path}
        data-source-control-area={entry.area}
        // Why: open file gets the strongest accent, outranking the bulk-selection tint so it always reads as active.
        data-current={isOpenFile ? "true" : undefined}
        className={cn(
          "group relative flex cursor-pointer items-center gap-1 pr-3 py-1 transition-colors",
          isOpenFile ? "bg-accent hover:bg-accent" : "hover:bg-accent/40",
          !isOpenFile && selected && "bg-accent/60",
        )}
        style={{
          paddingLeft: `${depth * SOURCE_CONTROL_TREE_INDENT_PX + SOURCE_CONTROL_TREE_FILE_PADDING_PX}px`,
        }}
        onClick={() => {
          if (onSelect) {
            onSelect(entryKey);
          }
          onOpen(entry);
        }}
        title={entry.origPath ? `renamed from ${entry.origPath}` : entry.path}
      >
        <File
          className="size-3.5 shrink-0"
          style={{ color: STATUS_COLORS[entry.status] }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 text-xs">
          <span className="min-w-0 block truncate">
            <span className="text-foreground">{fileName}</span>
            {showPathHint && dirPath && (
              <span className="ml-1.5 text-[11px] text-muted-foreground">{dirPath}</span>
            )}
          </span>
        </div>
        <DiffLineCounts added={entry.added} removed={entry.removed} />
        <span
          className="w-4 shrink-0 text-center text-[10px] font-bold"
          style={{ color: STATUS_COLORS[entry.status] }}
        >
          {STATUS_LABELS[entry.status]}
        </span>
        <div className={SOURCE_CONTROL_ROW_ACTION_OVERLAY_CLASS}>
          {canDiscard && (
            <ActionButton
              icon={entry.area === "untracked" ? Trash : Undo2}
              title={
                entry.area === "untracked"
                  ? "Delete untracked file"
                  : entry.status === "deleted"
                    ? "Restore file"
                    : "Discard changes"
              }
              onClick={(event) => {
                event.stopPropagation();
                onDiscard(entry);
              }}
            />
          )}
          {canStage && (
            <ActionButton
              icon={Plus}
              title="Stage"
              onClick={(event) => {
                event.stopPropagation();
                void onStage(entry.path);
              }}
            />
          )}
          {canUnstage && (
            <ActionButton
              icon={Minus}
              title="Unstage"
              onClick={(event) => {
                event.stopPropagation();
                void onUnstage(entry.path);
              }}
            />
          )}
        </div>
      </div>
    </SourceControlEntryContextMenu>
  );
});
