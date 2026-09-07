// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/commit/commit-action-menu.tsx.
// Adapter: local dropdown built on the radix-ui DropdownMenu the host
// already depends on; the commit shortcut combo renders as plain kbd chips
// (no ShortcutKeyCombo primitive in this repo).
import React from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { DropdownMenu, Tooltip } from "radix-ui";
import { Button } from "../../components/ui/button";
import { cn } from "./panel-class-names";
import { getCommitSubmitModifierLabel } from "./commit-shortcut";

export type CommitPrimaryActionKind = "commit" | "amend";

export type CommitPrimaryAction = {
  kind: CommitPrimaryActionKind;
  label: string;
  title: string;
  disabled: boolean;
};

export type CommitDropdownEntry =
  | { kind: "separator"; id: string }
  | { kind: string; id: string; label: string; hint?: string; title: string; disabled?: boolean };

const MENU_CONTENT_CLASS =
  "min-w-[14rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md z-50";
const MENU_ITEM_CLASS =
  "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export function CommitActionMenu({
  showComposer,
  primaryAction,
  showSpinner,
  showChevronSpinner,
  dropdownItems,
  onPrimaryAction,
  onDropdownAction,
}: {
  showComposer: boolean;
  primaryAction: CommitPrimaryAction;
  showSpinner: boolean;
  showChevronSpinner: boolean;
  dropdownItems: CommitDropdownEntry[];
  onPrimaryAction: () => void;
  onDropdownAction: (kind: string) => void;
}): React.JSX.Element {
  const moreActionsLabel = "More commit and remote actions";
  return (
    // Why: action + chevron form one split button so the edit → commit → push loop stays in a single vertical band.
    <div className={cn("flex items-stretch gap-1", showComposer && "mt-1")}>
      <div className="flex flex-1 items-stretch">
        {/* Why: match the Checks hosted-review buttons so action-button shape is consistent across Source Control and Checks. */}
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span className="flex flex-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={primaryAction.disabled}
                onClick={() => onPrimaryAction()}
                className="w-full rounded-r-none px-3 text-[11px]"
                title={primaryAction.title}
              >
                {showSpinner ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" aria-hidden="true" />
                )}
                {primaryAction.label}
              </Button>
            </span>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="top"
              sideOffset={6}
              className="tooltip flex max-w-72 items-center gap-2"
            >
              <span>{primaryAction.title}</span>
              {primaryAction.kind === "commit" ? (
                <span className="flex items-center gap-0.5" aria-hidden="true">
                  <kbd className="rounded border border-current px-1 text-[10px]">
                    {getCommitSubmitModifierLabel()}
                  </kbd>
                  <kbd className="rounded border border-current px-1 text-[10px]">Enter</kbd>
                </span>
              ) : null}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <DropdownMenu.Root>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span className="inline-flex shrink-0">
                <DropdownMenu.Trigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      "rounded-l-none border-l border-border px-1.5 shrink-0",
                      // Why: mirror the primary's disabled dimming for a unified look, but the chevron stays clickable (its push/fetch/pull stay valid when Commit is disabled).
                      primaryAction.disabled && "opacity-50",
                    )}
                    aria-label={moreActionsLabel}
                    title="More actions"
                  >
                    {showChevronSpinner ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </Button>
                </DropdownMenu.Trigger>
              </span>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content side="top" sideOffset={6} className="tooltip">
                {moreActionsLabel}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" className={MENU_CONTENT_CLASS}>
              {dropdownItems.map((entry) =>
                !("label" in entry) ? (
                  <DropdownMenu.Separator key={entry.id} className="my-1 h-px bg-border" />
                ) : (
                  <Tooltip.Root key={entry.id}>
                    <Tooltip.Trigger asChild>
                      <div className="block">
                        <DropdownMenu.Item
                          className={`${MENU_ITEM_CLASS} w-full`}
                          disabled={entry.disabled}
                          title={entry.title}
                          onSelect={(event) => {
                            if (entry.disabled) {
                              event.preventDefault();
                              return;
                            }
                            onDropdownAction(entry.kind);
                          }}
                        >
                          <span className="flex min-w-0 flex-col">
                            <span>{entry.label}</span>
                            {entry.hint ? (
                              <span className="truncate text-[10px] text-muted-foreground">
                                {entry.hint}
                              </span>
                            ) : null}
                          </span>
                        </DropdownMenu.Item>
                      </div>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content side="left" sideOffset={8} className="tooltip max-w-72">
                        {entry.title}
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                ),
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}
