// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationListLocalRows.tsx.
// Adaptation: rows are this repo's ProjectedAutomationRow (AutomationSummary
// + workspace name); the Project cell shows the workspace, Host is local,
// the Agent cell shows the harness id under a "Harness" header (see
// AutomationListTableHeader). Row DOM, selected styling, keyboard
// activation and the actions menu stay structurally literal; the menu is a
// local role="menu" widget (no Radix dependency in this repo's UI set).
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "./automation-class-names";
import { formatUiAutomationSchedule } from "./automation-schedule-label";
import {
  formatAutomationDateTimeWithRelative,
} from "./automation-page-parts";
import type { ProjectedAutomationRow } from "./automation-list-projection";
import { AUTOMATIONS_TABLE_GRID_CLASS } from "./AutomationListTableHeader";
import { AutomationListLastRunCell } from "./AutomationListLastRunCell";
import { AutomationListStatusCell } from "./AutomationListStatusCell";

const LIST_TABLE_ROW_CLASS =
  "gap-3 border-b border-border/50 px-0 py-2 text-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

const LIST_TABLE_ROW_SELECTED_CLASS = "bg-accent/60";

const LIST_TABLE_STICKY_ROW_CELL_CLASS =
  "sticky left-0 bg-background pr-2 group-hover:bg-transparent";

function isRowActivationKey(event: React.KeyboardEvent): boolean {
  return (
    (event.key === "Enter" || event.key === " ") &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

export type AutomationListLocalRowsProps = {
  rows: readonly ProjectedAutomationRow[];
  selectedId: string | null;
  relativeNow: number;
  runningId: string | null;
  onSelect: (id: string) => void;
  onRunNow: (id: string) => void;
  onEdit: (id: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
};

function RowActionsMenu({
  row,
  running,
  onRunNow,
  onEdit,
  onToggle,
  onDelete,
}: {
  row: ProjectedAutomationRow;
  running: boolean;
  onRunNow: (id: string) => void;
  onEdit: (id: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { automation } = row;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open ]);

  const closeAnd = (action: () => void) => (): void => {
    setOpen(false);
    action();
  };

  const itemClass =
    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:opacity-50";

  return (
    <div ref={rootRef} className="relative flex items-center justify-center">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground [&_svg]:size-4"
        aria-label={`Automation actions for ${automation.name}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <MoreHorizontal className="size-4" />
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label={`Automation actions for ${automation.name}`}
          className="absolute right-0 top-full z-30 w-48 rounded-md border border-border bg-background p-1 shadow-md"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={running}
            className={itemClass}
            onClick={closeAnd(() => onRunNow(automation.id))}
          >
            <Play className="size-3.5" />
            <span className="min-w-0 truncate">Run Now</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={closeAnd(() => onEdit(automation.id))}
          >
            <Pencil className="size-3.5" />
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={closeAnd(() => onToggle(automation.id))}
          >
            {automation.enabled ? (
              <Pause className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
            {automation.enabled ? "Pause" : "Resume"}
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            className={cn(itemClass, "text-destructive hover:text-destructive")}
            onClick={closeAnd(() => onDelete(automation.id))}
          >
            <Trash2 className="size-3.5" />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AutomationListLocalRows({
  rows,
  selectedId,
  relativeNow,
  runningId,
  onSelect,
  onRunNow,
  onEdit,
  onToggle,
  onDelete,
}: AutomationListLocalRowsProps): React.JSX.Element {
  return (
    <>
      {rows.map((row) => {
        const { automation } = row;
        const scheduleLabel = formatUiAutomationSchedule(automation.cron);
        const nextRunLabel = automation.enabled
          ? formatAutomationDateTimeWithRelative(automation.nextRunAt, relativeNow)
          : "Paused";
        const isSelected = selectedId === automation.id;

        return (
          <div
            key={automation.id}
            role="button"
            tabIndex={0}
            data-automation-row-id={automation.id}
            data-current={isSelected ? "true" : undefined}
            data-testid={`automation-row-${automation.id}`}
            onClick={() => onSelect(automation.id)}
            onKeyDown={(event) => {
              if (!isRowActivationKey(event)) {
                return;
              }
              event.preventDefault();
              onSelect(automation.id);
            }}
            className={cn(
              AUTOMATIONS_TABLE_GRID_CLASS,
              LIST_TABLE_ROW_CLASS,
              isSelected && LIST_TABLE_ROW_SELECTED_CLASS,
            )}
          >
            <span className={LIST_TABLE_STICKY_ROW_CELL_CLASS}>
              <span className="min-w-0 truncate font-medium">{automation.name}</span>
            </span>
            <span className="min-w-0 truncate text-muted-foreground" title={scheduleLabel}>
              {scheduleLabel}
            </span>
            <span
              className="min-w-0 truncate text-muted-foreground"
              title={row.workspaceName}
            >
              {row.workspaceName}
            </span>
            <span className="min-w-0 truncate text-muted-foreground" title="Local">
              Local
            </span>
            <span className="min-w-0 truncate text-muted-foreground" title={nextRunLabel}>
              {nextRunLabel}
            </span>
            <AutomationListLastRunCell snapshot={row.lastRun} now={relativeNow} />
            <AutomationListStatusCell enabled={automation.enabled} />
            <span
              className="min-w-0 truncate text-center text-muted-foreground"
              title={automation.harness}
            >
              {automation.harness}
            </span>
            <RowActionsMenu
              row={row}
              running={runningId === automation.id}
              onRunNow={onRunNow}
              onEdit={onEdit}
              onToggle={onToggle}
              onDelete={onDelete}
            />
          </div>
        );
      })}
    </>
  );
}
