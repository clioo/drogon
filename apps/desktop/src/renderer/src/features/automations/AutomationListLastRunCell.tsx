// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationListLastRunCell.tsx with
// the cell text helper from automation-list-last-run.ts. Adaptation: the
// snapshot comes from this repo's list projection; the "Never" copy and the
// failed tone stay literal.
import { cn } from "./automation-class-names";
import {
  formatAutomationDateTime,
  formatAutomationRelativeTime,
} from "./automation-page-parts";
import type { AutomationLastRunSnapshot } from "./automation-list-projection";

export function formatAutomationLastRunCell(
  snapshot: AutomationLastRunSnapshot,
  now: number,
): { text: string; title: string; failed: boolean } {
  if (snapshot.at === null) {
    return { text: "Never", title: "Never ran", failed: false };
  }
  const absolute = formatAutomationDateTime(snapshot.at);
  const relative = formatAutomationRelativeTime(snapshot.at, now);
  const status = snapshot.statusLabel ? ` · ${snapshot.statusLabel}` : "";
  return {
    text: relative ? `${relative}${status}` : `${absolute}${status}`,
    title: `${absolute}${status}`,
    failed: snapshot.tone === "failed",
  };
}

export function AutomationListLastRunCell({
  snapshot,
  now,
}: {
  snapshot: AutomationLastRunSnapshot;
  now: number;
}): React.JSX.Element {
  const cell = formatAutomationLastRunCell(snapshot, now);
  const failed = cell.failed;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 truncate",
        failed ? "text-destructive" : "text-muted-foreground",
      )}
      title={cell.title}
    >
      {snapshot.tone !== "never" ? (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            failed ? "bg-destructive" : "bg-muted-foreground/70",
          )}
          aria-hidden="true"
        />
      ) : null}
      <span className="truncate">{cell.text}</span>
    </span>
  );
}
