// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationListFilterMenu.tsx.
// Adaptation: status + last-run filters only (agent/host catalog filters are
// out of MVP scope); the pill row keeps the reference DOM and copy.
import { useEffect, useRef, useState } from "react";
import { ListFilter, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "./automation-class-names";
import {
  countAutomationListFilters,
  type AutomationListFilter,
  type AutomationListLastRunFilter,
  type AutomationListStatusFilter,
} from "./automation-list-projection";

function FilterPill({
  label,
  value,
  onClear,
}: {
  label: string;
  value: string;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full border border-border/60 bg-muted/50 pl-2 pr-1 text-[11px] text-foreground">
      <span className="text-muted-foreground">{label}:</span>
      <span className="max-w-[140px] truncate font-medium" title={value}>
        {value}
      </span>
      <button
        type="button"
        aria-label={`Remove ${label} filter`}
        onClick={onClear}
        className="rounded-full p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

export function AutomationListFilterPills({
  filter,
  onChange,
}: {
  filter: AutomationListFilter;
  onChange: (next: AutomationListFilter) => void;
}): React.JSX.Element | null {
  const statusValueLabel =
    filter.status === "enabled"
      ? "Enabled"
      : filter.status === "paused"
        ? "Paused"
        : null;
  const lastRunValueLabel =
    filter.lastRun === "failed"
      ? "Failed"
      : filter.lastRun === "succeeded"
        ? "Succeeded"
        : filter.lastRun === "never"
          ? "Never ran"
          : null;
  if (!statusValueLabel && !lastRunValueLabel) return null;
  return (
    <>
      {statusValueLabel ? (
        <FilterPill
          label="Status"
          value={statusValueLabel}
          onClear={() => onChange({ ...filter, status: "all" })}
        />
      ) : null}
      {lastRunValueLabel ? (
        <FilterPill
          label="Last run"
          value={lastRunValueLabel}
          onClear={() => onChange({ ...filter, lastRun: "all" })}
        />
      ) : null}
    </>
  );
}

function RadioRow({
  checked,
  label,
  onSelect,
}: {
  checked: boolean;
  label: string;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-3.5 items-center justify-center rounded-full border",
          checked ? "border-primary" : "border-muted-foreground",
        )}
      >
        {checked ? <span className="size-1.5 rounded-full bg-primary" /> : null}
      </span>
      {label}
    </button>
  );
}

const STATUS_OPTIONS: readonly {
  value: AutomationListStatusFilter;
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "paused", label: "Paused" },
];

const LAST_RUN_OPTIONS: readonly {
  value: AutomationListLastRunFilter;
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "never", label: "Never ran" },
];

export function AutomationListFilterMenu({
  filter,
  onChange,
}: {
  filter: AutomationListFilter;
  onChange: (next: AutomationListFilter) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeCount = countAutomationListFilters(filter);

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

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Filters"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="border border-border bg-background shadow-none hover:bg-muted/50"
      >
        <ListFilter className="size-4" />
        Filters
        {activeCount > 0 ? (
          <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
            {activeCount}
          </span>
        ) : null}
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label="Filters"
          className="absolute left-0 top-full z-30 mt-1 w-48 rounded-md border border-border bg-background p-1 shadow-md"
        >
          <div className="px-2 py-1.5 text-[11px] font-medium uppercase text-muted-foreground">
            Status
          </div>
          {STATUS_OPTIONS.map((option) => (
            <RadioRow
              key={option.value}
              checked={filter.status === option.value}
              label={option.label}
              onSelect={() => onChange({ ...filter, status: option.value })}
            />
          ))}
          <div className="my-1 h-px bg-border" />
          <div className="px-2 py-1.5 text-[11px] font-medium uppercase text-muted-foreground">
            Last run
          </div>
          {LAST_RUN_OPTIONS.map((option) => (
            <RadioRow
              key={option.value}
              checked={filter.lastRun === option.value}
              label={option.label}
              onSelect={() => onChange({ ...filter, lastRun: option.value })}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
