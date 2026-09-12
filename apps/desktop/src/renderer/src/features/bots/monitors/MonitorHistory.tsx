/* C10 bots monitors: monitor list row + check history surface.
 * Original to this repo. History is retained evidence (including errors
 * and delivery uncertainty); disable/delete stop new admissions only. */

import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import {
  monitorActionsEnabled,
  monitorOutcomeLabel,
  monitorResourceLabel,
  monitorStatusLabel,
  visibleMonitorChecks,
} from "./monitor-model";
import type { MonitorCheckView, MonitorRecordView } from "./monitor-model";

export function MonitorHistory({
  checks,
  limit = 5,
}: {
  checks: MonitorCheckView[];
  limit?: number;
}) {
  const visible = visibleMonitorChecks(checks, limit);
  if (!visible.length) {
    return <p className="text-xs text-muted-foreground">No checks yet.</p>;
  }
  return (
    <div className="space-y-2" role="list" aria-label="Monitor history">
      {visible.map((check) => (
        <div
          key={check.id}
          role="listitem"
          data-testid={`monitor-check-${check.id}`}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs"
        >
          <span>{monitorOutcomeLabel(check)}</span>
          <span className="text-muted-foreground">
            {check.outcome === "changed" && check.delivery !== "not_applicable"
              ? `delivery ${check.delivery}`
              : check.outcome}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MonitorCard({
  monitor,
  checks,
  busy,
  onToggleEnabled,
  onRunCheck,
  onDelete,
}: {
  monitor: MonitorRecordView;
  checks: MonitorCheckView[];
  busy: boolean;
  onToggleEnabled: () => void;
  onRunCheck: () => void;
  onDelete: () => void;
}) {
  const supported = monitorActionsEnabled(monitor);
  return (
    <Card data-testid={`monitor-${monitor.id}`}>
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-sm">
            {supported ? monitorResourceLabel(monitor) : monitor.ruleKind}
            <span className="ml-2 font-normal text-muted-foreground">
              v{monitor.version}
            </span>
          </CardTitle>
          <Badge variant="outline">{monitorStatusLabel(monitor)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {!supported ? (
          <p className="text-xs text-muted-foreground" role="status">
            Unsupported rule kind — this build cannot approve or run it. Update
            Drogon to manage this monitor.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !supported}
            data-testid={`monitor-run-${monitor.id}`}
            onClick={onRunCheck}
          >
            Run check
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !supported}
            data-testid={`monitor-toggle-${monitor.id}`}
            onClick={onToggleEnabled}
          >
            {monitor.enabled ? "Disable" : "Enable"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            data-testid={`monitor-delete-${monitor.id}`}
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
        {monitor.lastError ? (
          <p className="text-xs text-muted-foreground" role="status">
            Last error: {monitor.lastError}
          </p>
        ) : null}
        <MonitorHistory checks={checks} />
      </CardContent>
    </Card>
  );
}

export default MonitorCard;
