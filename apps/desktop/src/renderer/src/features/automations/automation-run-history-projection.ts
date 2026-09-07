// MIT Copyright (c) 2026 Lovecast Inc. Run-history projection for the
// local-automation detail pane. Status vocabulary mirrors Orca's
// getAutomationRunStatusLabel/Variant over this repo's AutomationRunView
// wire statuses; datetimes reuse the shared page-parts formatters.
import type { AutomationRunView } from "../../../../shared/automation-contract";
import {
  formatAutomationDateTime,
  formatAutomationDateTimeWithRelative,
} from "./automation-page-parts";

export type AutomationRunStatusVariant =
  | "secondary"
  | "outline"
  | "destructive"
  | "dot";

export function getAutomationHistoryStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case "pending":
      return "Queued";
    case "dispatching":
      return "Starting";
    case "dispatched":
      return "Launched";
    case "completed":
      return "Done";
    case "skipped_precheck":
      return "Precheck skipped";
    case "skipped_missed":
      return "Skipped";
    case "skipped_unavailable":
      return "Unavailable";
    case "skipped_needs_interactive_auth":
      return "Needs credentials";
    case "dispatch_failed":
      return "Failed";
    default:
      return status;
  }
}

export function getAutomationHistoryStatusVariant(
  status: string,
): AutomationRunStatusVariant {
  const normalized = status.toLowerCase();
  if (normalized === "dispatched" || normalized === "completed") {
    return "secondary";
  }
  if (normalized.startsWith("skipped")) {
    return "outline";
  }
  if (normalized === "dispatch_failed") {
    return "destructive";
  }
  return "dot";
}

export type ProjectedAutomationRun = {
  run: AutomationRunView;
  statusLabel: string;
  statusVariant: AutomationRunStatusVariant;
  scheduledLabel: string;
  detailLabel: string;
};

function detailLabelFor(run: AutomationRunView): string {
  if (run.error !== null && run.error !== "") return run.error;
  if (run.exitCode !== null) return `exit=${run.exitCode}`;
  return "—";
}

export function projectAutomationRunHistory(
  runs: readonly AutomationRunView[],
  now: number,
): ProjectedAutomationRun[] {
  return runs.map((run) => ({
    run,
    statusLabel: getAutomationHistoryStatusLabel(run.status),
    statusVariant: getAutomationHistoryStatusVariant(run.status),
    scheduledLabel: formatAutomationDateTimeWithRelative(run.scheduledFor, now),
    detailLabel: detailLabelFor(run),
  }));
}

export function formatAutomationRunCountLabel(
  runs: readonly AutomationRunView[],
): string {
  const completed = runs.filter(
    (run) => run.status.toLowerCase() === "completed",
  ).length;
  const unit = runs.length === 1 ? "run" : "runs";
  return `${runs.length} ${unit} · ${completed} completed`;
}

export { formatAutomationDateTime };
