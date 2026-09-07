// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationListTableHeader.tsx and
// automations-table-layout.ts. Literal port of the column order and copy.
export const AUTOMATIONS_TABLE_GRID_CLASS =
  "grid grid-cols-[minmax(11rem,1.8fr)_minmax(6.5rem,9.5rem)_minmax(4.5rem,7.5rem)_minmax(4.5rem,7rem)_minmax(7.5rem,9.5rem)_minmax(7rem,9.5rem)_minmax(4.5rem,5.5rem)_2.5rem_2.5rem]";

const LIST_TABLE_HEADER_CLASS =
  "sticky top-0 z-10 border-y border-border/50 bg-background/95 py-1.5 text-[11px] font-medium uppercase text-muted-foreground backdrop-blur";

const LIST_TABLE_STICKY_HEADER_CELL_CLASS = "sticky left-0 bg-background/95 pr-2";

export function AutomationListTableHeader(): React.JSX.Element {
  // Column order mirrors the reference (Name | Schedule | Project | Host |
  // Next run | Last run | Status | Agent | Actions). Adaptation: this repo
  // schedules a harness into a workspace on the local host, so Project shows
  // the workspace name, Host is always Local, and Agent shows the harness id
  // under a Harness header.
  const labels = [
    "Name",
    "Schedule",
    "Project",
    "Host",
    "Next run",
    "Last run",
    "Status",
    "Harness",
  ] as const;
  return (
    <div className={`${AUTOMATIONS_TABLE_GRID_CLASS} ${LIST_TABLE_HEADER_CLASS}`}>
      {labels.map((label, index) => (
        <span
          key={label}
          className={
            index === 0
              ? LIST_TABLE_STICKY_HEADER_CELL_CLASS
              : index === labels.length - 1
                ? "text-center"
                : undefined
          }
        >
          {label}
        </span>
      ))}
      <span className="sr-only">Actions</span>
    </div>
  );
}
