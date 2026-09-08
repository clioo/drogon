/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/new-workspace/NewWorkspaceComposerFooter.tsx
   (adapter: the error is this repo's verbatim daemon/client string, not the
   source's {title,message,help} object; the Drogon-only "Start Quick Session"
   button is not ported — Drogon's folder projects already create their
   implicit workspace through the primary action; i18n keys inlined). */
import React from "react";
import { CornerDownLeft, LoaderCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { SwitchIndicator } from "../../components/ui/switch";
import { cn } from "../../lib/utils";

type NewWorkspaceComposerFooterProps = {
  createError: string | null;
  showCreateMultiple: boolean;
  createMultiple: boolean;
  onCreateMultipleChange: (next: boolean) => void;
  onCreate: () => void;
  createDisabled: boolean;
  creating: boolean;
  primaryActionLabel: string;
  submitShortcutModifierLabel: string;
};

export function NewWorkspaceComposerFooter({
  createError,
  showCreateMultiple = false,
  createMultiple = false,
  onCreateMultipleChange,
  onCreate,
  createDisabled,
  creating,
  primaryActionLabel,
  submitShortcutModifierLabel,
}: NewWorkspaceComposerFooterProps): React.JSX.Element {
  return (
    <>
      {createError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {createError}
        </div>
      ) : null}

      <div
        className={cn(
          "flex items-center gap-3",
          showCreateMultiple ? "justify-between" : "justify-end",
        )}
      >
        {showCreateMultiple ? (
          <button
            type="button"
            role="switch"
            aria-checked={createMultiple}
            onClick={() => onCreateMultipleChange(!createMultiple)}
            className="group flex w-fit cursor-pointer items-center gap-2 rounded-md text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <SwitchIndicator checked={createMultiple} />
            <span className="text-muted-foreground transition-colors group-hover:text-foreground">
              Create more
            </span>
          </button>
        ) : null}
        <Button
          onClick={() => void onCreate()}
          disabled={createDisabled}
          size="sm"
          className="text-xs"
          data-primary-action="workspace-session"
        >
          {creating ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {primaryActionLabel}
          <span className="ml-1 inline-flex items-center gap-0.5 rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-medium leading-none text-current/80">
            <span>{submitShortcutModifierLabel}</span>
            <CornerDownLeft className="size-3" />
          </span>
        </Button>
      </div>
    </>
  );
}
