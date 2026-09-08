// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// src/renderer/src/components/right-sidebar/useFileExplorerRowDrag.ts:
// per-row internal drag handling — dragenter/dragleave counting (nested
// row children fire pairs), the drop-target highlight, the 500 ms
// drag-expand timer for closed directories, and the drop that issues one
// move per dragged top-level path. Adapted: the native OS file branch
// (import through the preload relay) is out of MVP scope, and the edge
// auto-scroll loop has no virtualizer to fight here, so both stay out.

import { useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  getWorkspaceFileDragRejectionMessage,
  readWorkspaceFileDragPaths,
  WORKSPACE_FILE_PATH_MIME,
} from "./workspace-file-drag";

const DRAG_EXPAND_DELAY_MS = 500;

type UseFileExplorerRowDragParams = {
  rowDropDir: string;
  isDirectory: boolean;
  nodePath: string;
  isExpanded: boolean;
  onDragTargetChange: (dir: string | null) => void;
  onDragExpandDir: (dirPath: string) => void;
  onMoveDrop: (sourcePath: string, destDir: string) => void;
};

type RowDragHandlers = {
  handleDragOver: (e: React.DragEvent) => void;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
};

export function useFileExplorerRowDrag({
  rowDropDir,
  isDirectory,
  nodePath,
  isExpanded,
  onDragTargetChange,
  onDragExpandDir,
  onMoveDrop,
}: UseFileExplorerRowDragParams): RowDragHandlers {
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragCounterRef = useRef(0);

  const clearExpandTimer = useCallback(() => {
    if (expandTimerRef.current !== null) {
      clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(WORKSPACE_FILE_PATH_MIME)) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(WORKSPACE_FILE_PATH_MIME)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current += 1;
      onDragTargetChange(rowDropDir);
      if (dragCounterRef.current === 1 && isDirectory && !isExpanded) {
        clearExpandTimer();
        expandTimerRef.current = setTimeout(() => {
          expandTimerRef.current = null;
          onDragExpandDir(nodePath);
        }, DRAG_EXPAND_DELAY_MS);
      }
    },
    [rowDropDir, isDirectory, isExpanded, nodePath, onDragTargetChange, onDragExpandDir, clearExpandTimer],
  );

  const handleDragLeave = useCallback(() => {
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      clearExpandTimer();
    }
  }, [clearExpandTimer]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(WORKSPACE_FILE_PATH_MIME)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      clearExpandTimer();
      dragCounterRef.current = 0;
      onDragTargetChange(null);
      const dragPaths = readWorkspaceFileDragPaths(e.dataTransfer);
      if (dragPaths.status === "rejected") {
        toast.error(getWorkspaceFileDragRejectionMessage(dragPaths.reason));
        return;
      }
      for (const sourcePath of dragPaths.paths) {
        onMoveDrop(sourcePath, rowDropDir);
      }
    },
    [rowDropDir, onDragTargetChange, onMoveDrop, clearExpandTimer],
  );

  return { handleDragOver, handleDragEnter, handleDragLeave, handleDrop };
}
