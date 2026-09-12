/* MIT Copyright (c) 2026 Lovecast Inc.
 * One card in the redesigned MONITORS column (owner-design mockup): the
 * watched resource as the title, the daemon's own health chip, and a
 * two-column grid of uppercase-labelled fields — SOURCE, TRIGGER, ACTION,
 * FAILURE THRESHOLD, LAST CHECK, LAST FIRING, INCIDENTS — over a footer
 * carrying the real monitor id.
 * Honesty contract: rows come verbatim from `bot.monitor_list` (durable
 * health, check evidence, firing evidence and the real failure-threshold
 * constant). ACTION shows what the monitor releases when it fires — a
 * bound responsibility's dispatch, or an honest "Observes only"; LAST
 * FIRING shows the newest delegation verdict ("Prompt sent", "Refused",
 * …) straight from the drain's durable firing rows. The mockup's
 * CHECK-IN MARGIN, MAX RUNTIME, RECOVERY THRESHOLD, NOTIFY and SLA strip
 * have NO stored counterpart in this build and are omitted rather than
 * invented; the "Test" button is omitted because the only test RPC is
 * the bot's own self API, not callable from the UI. */

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import type { BotMonitorView } from "../../../../shared/bot-contract";
import {
  monitorActionLabel,
  monitorHealthPill,
  monitorLastCheck,
  monitorLastFiring,
  monitorSourceLabel,
  monitorTitle,
  monitorTriggerLabel,
} from "./bots-page-model";
import { monitorRuleKindSupported } from "./monitors/monitor-model";

function GridCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 truncate text-sm text-foreground">{children}</div>
    </div>
  );
}

export function BotMonitorCardItem({
  monitor,
  responsibilityName = null,
  now = Date.now(),
  onApprove,
  approving = false,
  botDisplayName = null,
}: {
  monitor: BotMonitorView;
  /** The bound responsibility's display name, resolved by the parent
   *  from the bot's own responsibilities; null falls back to the id. */
  responsibilityName?: string | null;
  now?: number;
  /** The parked-watch approval path: arms the monitor's CURRENT rule
   *  text through the daemon's hash-bound `bot.monitor_approve` (the
   *  same approval the CLI uses — no second path). The disclosure above
   *  the button names exactly what is being approved. */
  onApprove?: () => void;
  approving?: boolean;
  /** The owning bot's display name, for the approval disclosure. */
  botDisplayName?: string | null;
}) {
  const pill = monitorHealthPill(monitor.health);
  const lastCheck = monitorLastCheck(monitor, now);
  const lastFiring = monitorLastFiring(monitor, now);
  const supported = monitorRuleKindSupported(monitor.ruleKind);
  const actionLabel = monitorActionLabel(monitor, responsibilityName);
  const sourceLabel = monitorSourceLabel(monitor);
  const pendingApproval = supported && !monitor.approved;
  const filter =
    typeof monitor.filter === "string" && monitor.filter
      ? monitor.filter
      : null;
  const login =
    typeof monitor.login === "string" && monitor.login ? monitor.login : null;
  const repo =
    typeof monitor.repo === "string" && monitor.repo ? monitor.repo : null;
  return (
    <div
      data-testid={`bot-monitor-${monitor.monitorId}`}
      className="rounded-lg border border-border px-3 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate font-mono text-xs font-medium">
          {monitorTitle(monitor)}
        </span>
        <Badge
          variant={
            pill.tone === "watching"
              ? "secondary"
              : pill.tone === "failing"
                ? "destructive"
                : "outline"
          }
        >
          {pill.label}
        </Badge>
      </div>
      {!supported ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          Unsupported rule kind — update Drogon to manage this monitor.
        </p>
      ) : null}
      {monitor.lastError ? (
        <p className="mt-2 truncate text-xs text-destructive" role="status">
          Last error: {monitor.lastError}
        </p>
      ) : null}
      {monitor.lastNotice ? (
        // An informational note (the baseline seed, for example) is NOT
        // an error: normal operation must never read as a red failure.
        <p className="mt-2 truncate text-xs text-muted-foreground" role="status">
          {monitor.lastNotice}
        </p>
      ) : null}
      {pendingApproval ? (
        <div
          className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2"
          data-testid={`monitor-approval-${monitor.monitorId}`}
        >
          <p className="text-xs text-foreground">
            Parked at needs-approval. Approving arms the CURRENT rule text
            (hash-bound, the same approval the CLI uses):{" "}
            {monitor.ruleKind === "github_pr.v1"
              ? `a pull-request watch on ${repo ?? "the recorded repository"}${filter ? ` (${filter}${login ? `, ${login}` : ""})` : ""}`
              : `a ${monitor.ruleKind} watch`}
            {" "}
            {monitor.responsibilityId
              ? `for ${botDisplayName ?? "this bot"} — when it fires it will dispatch ${responsibilityName ?? monitor.responsibilityId}.`
              : `for ${botDisplayName ?? "this bot"} — it observes and records only.`}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={approving}
            data-testid={`monitor-approve-${monitor.monitorId}`}
            onClick={onApprove}
          >
            {approving ? "Approving…" : "Approve this watch"}
          </Button>
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <GridCell label="Source">
          <span className="font-mono text-xs">{sourceLabel}</span>
        </GridCell>
        <GridCell label="Trigger">
          <span className="font-mono text-xs">
            {monitorTriggerLabel(monitor.trigger)}
          </span>
        </GridCell>
        <GridCell label="Action">
          {monitor.responsibilityId ? (
            <span>{actionLabel}</span>
          ) : (
            <span className="italic text-muted-foreground">{actionLabel}</span>
          )}
        </GridCell>
        <GridCell label="Failure threshold">
          {monitor.failureThreshold} consecutive errors
        </GridCell>
        <GridCell label="Last check">
          {lastCheck ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden
                className={
                  monitor.health === "healthy"
                    ? "size-2 shrink-0 rounded-full bg-emerald-500"
                    : monitor.health === "failing"
                      ? "size-2 shrink-0 rounded-full bg-destructive"
                      : "size-2 shrink-0 rounded-full bg-amber-500"
                }
              />
              <span className="truncate">
                {lastCheck.healthLabel} · {lastCheck.ageLabel}
              </span>
            </span>
          ) : (
            <span className="italic text-muted-foreground">No checks yet</span>
          )}
        </GridCell>
        <GridCell label="Last firing">
          {lastFiring ? (
            <span className="flex min-w-0 flex-col gap-0.5">
              <span
                className={
                  lastFiring.adverse
                    ? "truncate text-destructive"
                    : "truncate"
                }
              >
                {lastFiring.label}
                {lastFiring.caseLabel ? ` · ${lastFiring.caseLabel}` : ""} ·{" "}
                {lastFiring.ageLabel}
              </span>
              {lastFiring.detail ? (
                <span className="truncate text-xs text-muted-foreground">
                  {lastFiring.detail}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="italic text-muted-foreground">Never fired</span>
          )}
        </GridCell>
        {monitor.incidentCount > 0 ? (
          <GridCell label="Incidents">
            {monitor.incidentCount === 1
              ? "1 incident recorded"
              : `${monitor.incidentCount} incidents recorded`}
          </GridCell>
        ) : null}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2">
        <span className="text-xs text-muted-foreground">
          {monitor.delegationsToday.used}/{monitor.delegationsToday.max}{" "}
          delegations today
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {monitor.monitorId}
        </span>
      </div>
    </div>
  );
}

export default BotMonitorCardItem;
