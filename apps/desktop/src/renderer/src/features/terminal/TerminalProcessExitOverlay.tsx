// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/TerminalProcessExitOverlay.tsx.
// Adapted: translate() calls are plain English strings (Drogon has no i18n
// catalog) and the process-exit shape is the local terminal-process-exit.ts
// projection. Structure, classes, icons and copy are unchanged.
import { RotateCw, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  describeTerminalProcessExit,
  terminalProcessExitActionLabel,
  type TerminalProcessExit,
} from "./terminal-process-exit";

export function TerminalProcessExitOverlay({
  processExit,
  onRestart,
  onClose,
}: {
  processExit: TerminalProcessExit;
  onRestart: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { title, detail } = describeTerminalProcessExit(processExit);
  const actionLabel = terminalProcessExitActionLabel(processExit);

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-end justify-center p-4">
      <div
        role="alert"
        className="pointer-events-auto flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-xs"
      >
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{detail}</div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <X />
            Close
          </Button>
          <Button type="button" size="sm" onClick={onRestart}>
            <RotateCw />
            {actionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
