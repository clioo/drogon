/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/new-workspace/RunTargetCombobox.tsx
   (adapter: local-only — Drogon has no remote SSH hosts, runtime servers or
   ephemeral VM recipes, so the source's needs-setup rows, recipes submenu and
   pinned "Add host" row are not ported; a single ready local target renders
   exactly as the fork renders its ready local host). */
import React, { useCallback, useMemo } from "react";
import { Popover, PopoverContent } from "../../components/ui/popover";
import { cn } from "../../lib/utils";
import { isWithinComboboxRoot, useTypeAheadCombobox } from "./use-type-ahead-combobox";
import { COMBOBOX_POPOVER_SURFACE } from "./type-ahead-combobox-styles";
import { HostRowIcon, RunTargetRow } from "./RunTargetComboboxRow";
import { buildRunTargetRows, type ReadyRunTargetOption } from "./run-target-options";
import RunTargetField from "./RunTargetField";

type RunTargetComboboxProps = {
  hostOptions: readonly ReadyRunTargetOption[];
  hostValue: string | null;
  onHostChange?: (setupId: string) => void;
};

const ROOT_ATTRIBUTE = "data-run-target-combobox-root";

/**
 * Run-target picker, built to match the project picker: the field *is* the
 * search, exactly one row is armed and Enter takes it, and hovering arms, so
 * the pointer and the keyboard drive one cursor.
 */
export default function RunTargetCombobox({
  hostOptions,
  hostValue,
  onHostChange,
}: RunTargetComboboxProps): React.JSX.Element {
  const deriveRowKeys = useCallback(
    (query: string): string[] =>
      buildRunTargetRows({ hostOptions, query }).rows.map((row) => row.key),
    [hostOptions],
  );
  const combobox = useTypeAheadCombobox(deriveRowKeys);
  const { query, setQuery, open, setOpen, armedKey, arm, moveArm, inputRef, listId, setListNode } =
    combobox;

  const { rows } = useMemo(() => buildRunTargetRows({ hostOptions, query }), [hostOptions, query]);
  const readyHostOptions = useMemo(
    () => hostOptions.filter((option) => option.kind === "ready"),
    [hostOptions],
  );
  const selectedHost =
    readyHostOptions.find((option) => option.id === hostValue) ?? readyHostOptions[0] ?? null;
  const armedRow = rows.find((row) => row.key === armedKey) ?? rows[0] ?? null;
  // Only a committed selection paints the field; typing replaces it.
  const committed = query.length === 0 && selectedHost !== null;

  const close = useCallback((): void => {
    combobox.close();
  }, [combobox]);

  const selectHost = useCallback(
    (setupId: string): void => {
      onHostChange?.(setupId);
      close();
    },
    [close, onHostChange],
  );

  /** Commits a row. */
  const activate = useCallback(
    (key: string | null): void => {
      const row = rows.find((candidate) => candidate.key === key);
      if (!row) {
        return;
      }
      selectHost(row.option.id);
    },
    [rows, selectHost],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setOpen(true);
        moveArm(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if ((event.key === "Enter" || event.key === "ArrowRight") && open) {
        event.preventDefault();
        activate(armedRow?.key ?? null);
        return;
      }
      if (event.key === "Escape" && (open || query.length > 0)) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    },
    [activate, armedRow, close, moveArm, open, query, setOpen],
  );

  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (next) {
        setOpen(true);
        return;
      }
      close();
    },
    [close, setOpen],
  );

  const fieldLabel = selectedHost?.label ?? "";
  const fieldDetail = selectedHost?.path ?? "";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <RunTargetField
        query={query}
        onQueryChange={(value) => {
          setQuery(value);
          setOpen(true);
        }}
        open={open}
        onOpenRequest={() => setOpen(true)}
        onToggle={() => setOpen(!open)}
        committed={committed}
        isRecipe={false}
        hostId={selectedHost?.hostId ?? null}
        label={fieldLabel}
        detail={fieldDetail}
        listId={listId}
        hasArmedRow={armedRow !== null}
        inputRef={inputRef}
        onKeyDown={handleKeyDown}
      />
      <PopoverContent
        align="start"
        sideOffset={4}
        className={cn(
          "flex w-[var(--radix-popover-trigger-width)] min-w-[18rem] flex-col p-0",
          COMBOBOX_POPOVER_SURFACE,
        )}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        // The field lives in the anchor, not the content, so Radix would see a
        // focus/pointer event "outside" and dismiss the instant you tab in.
        onFocusOutside={(event) => {
          if (isWithinComboboxRoot(event.target, ROOT_ATTRIBUTE)) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (isWithinComboboxRoot(event.target, ROOT_ATTRIBUTE)) {
            event.preventDefault();
          }
        }}
      >
        <div
          id={listId}
          role="listbox"
          aria-label="Run targets"
          className="flex min-h-0 flex-col"
        >
          <div
            ref={setListNode}
            role="presentation"
            className="max-h-72 min-h-0 flex-1 overflow-y-auto p-1 scrollbar-sleek"
          >
            {rows.length === 0 ? (
              <p className="flex h-8 items-center justify-center px-2 text-sm text-muted-foreground">
                No run targets are ready for this project.
              </p>
            ) : null}
            {rows.map((row) => {
              const isArmed = armedRow?.key === row.key;
              const optionId = isArmed ? `${listId}-armed` : undefined;
              return (
                <RunTargetRow
                  key={row.key}
                  icon={<HostRowIcon hostId={row.option.hostId} />}
                  label={row.option.label}
                  detail={row.option.path}
                  armed={isArmed}
                  current={row.option.id === selectedHost?.id}
                  optionId={optionId}
                  onArm={() => arm(row.key)}
                  onCommit={() => selectHost(row.option.id)}
                />
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
