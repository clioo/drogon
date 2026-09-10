/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/BotResponsibilityCard.tsx onto the Card
   and Badge primitives the fork uses (Card, CardHeader, CardTitle,
   CardDescription, CardContent, Badge).
   R17-E #348: the fork's exact card surface is restored — the header Delete
   acts immediately (no confirm dialog — invented UI removed), the
   responsibility rows carry only the fork's icon/name/kind-badge plus the
   Run control, the history rows carry the fork's name + evidence line
   (invocation badge and observation suffix removed), and "Open session" +
   Delete + Add responsibility render unconditionally with the fork's copy
   ("No session yet"). `data-testid` hooks stay: the packaged probe and
   contract tests address the card through them.
   Additive dashboard (Carlos directive, collapsed by default so the above
   surface is byte-identical until expanded): a Details toggle revealing
   AUTOMATIONS (scheduled responsibilities with scheduler status and last
   run evidence from the mounted history, Run now over the existing
   handler, Add automation over the existing form) and MONITORS (honest
   empty note — monitor rules have no service backing, so no rows and no
   dead actions are rendered).
   Adapters for this repo (data layer, declared): getAgentLabel is the
   local botHarnessLabel; history evidence is the fork's
   `status · id` shape with the run NUMBER standing in for the raw id
   (`completed · run 1`) — the snapshot now projects both the linked
   run's status verdict and the per-automation ordinal the native store
   assigns at creation, mirroring the fork's `nextAutomationRunNumber`;
   `preset` narrows the transport string to the preset union at the
   avatar boundary — native owns preset validation and an unknown preset
   falls to the Bot glyph exactly like the fork's `none`. */

import { useState } from "react";
import { CalendarClock, ChevronDown, Play, Plus, Zap } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import type {
  BotsPanelBot,
  BotsPanelHistoryEntry,
} from "./bots-panel-contracts";
import {
  HARNESS_DEFAULT_MODEL_LABEL,
  SESSION_LINKED_LABEL,
  SESSION_NONE_LABEL,
} from "./bots-panel-projection";
import { DrogonBotAvatar } from "./DrogonBotAvatar";
import { botHarnessLabel } from "./bots-page-model";
import type { DrogonBotCharacterPreset } from "./bot-characters";

/** Right-hand evidence line for one history row, the fork's
 *  `automationRun.status · automationRun.id` shape with this repo's
 *  declared run-number adapter standing in for the raw id: a linked run
 *  renders its verdict and ordinal (`completed · run 1`), so the row
 *  settles exactly when the run does. The number/status join is null for
 *  rows whose automation run predates the projection (or was deleted),
 *  never invented. Orphaned rows keep their null joins visible: a Mentu
 *  run id, else the bare recorded marker. */
function historyDetail(entry: BotsPanelHistoryEntry): string {
  if (
    entry.automationRunNumber !== null &&
    entry.automationRunNumber !== undefined
  ) {
    const ordinal = `run ${entry.automationRunNumber}`;
    return entry.automationRunStatus
      ? `${entry.automationRunStatus} · ${ordinal}`
      : `${entry.automationName ?? "automation"} · ${ordinal}`;
  }
  if (entry.run.recipe?.runId) {
    return `Mentu run ${entry.run.recipe.runId}`;
  }
  return "Recorded";
}

export function BotResponsibilityCard({
  bot,
  history,
  onAddResponsibility,
  onDelete,
  onRunResponsibility,
  onLaunch,
}: {
  bot: BotsPanelBot;
  history: BotsPanelHistoryEntry[];
  onAddResponsibility: () => void;
  onDelete: () => void;
  onRunResponsibility: (responsibilityId: string) => void;
  onLaunch: () => void;
}): React.JSX.Element {
  const botHistory = history.filter((entry) => entry.run.botId === bot.id);
  // Dashboard expansion (Carlos directive): collapsed is the fork-verbatim
  // surface above; expanded adds AUTOMATIONS + MONITORS sections built only
  // from the mounted snapshot/history — no invented rows, no dead actions.
  const [expanded, setExpanded] = useState(false);
  const automations = bot.responsibilities.filter(
    (responsibility) => responsibility.kind === "scheduled",
  );
  return (
    <Card data-testid={`bot-${bot.id}`}>
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <DrogonBotAvatar
                preset={bot.characterPreset as DrogonBotCharacterPreset}
                alt={`${bot.displayIdentity.displayName} avatar`}
                className="size-9"
              />
              <span className="truncate">
                {bot.displayIdentity.displayName}
              </span>
              {bot.characterPreset !== "none" ? (
                <Badge variant="outline">{bot.characterPreset}</Badge>
              ) : null}
            </CardTitle>
            <CardDescription
              className="mt-2"
              data-testid={`bot-description-${bot.id}`}
            >
              {(bot.displayIdentity.title ?? bot.instructions) ||
                "Ready for a purpose"}
              {bot.displayIdentity.handle
                ? ` · @${bot.displayIdentity.handle}`
                : ""}
            </CardDescription>
            <Button
              className="mt-3"
              variant="outline"
              size="sm"
              data-testid={`open-session-${bot.id}`}
              onClick={onLaunch}
            >
              <Play />
              Open session
            </Button>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              data-testid={`bot-details-${bot.id}`}
              aria-expanded={expanded}
              aria-label={`${expanded ? "Hide" : "Show"} ${bot.displayIdentity.displayName} details`}
              onClick={() => setExpanded((value) => !value)}
            >
              Details
              <ChevronDown
                className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                aria-hidden
              />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid={`delete-bot-${bot.id}`}
              onClick={onDelete}
            >
              Delete
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-6">
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Harness</p>
            <p className="mt-1 font-medium">
              {botHarnessLabel(bot.harnessPolicy.defaultHarness)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Model policy</p>
            <p className="mt-1 font-medium">
              {bot.harnessPolicy.explicitModel ?? HARNESS_DEFAULT_MODEL_LABEL}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Session</p>
            <p className="mt-1 font-medium">
              {bot.currentSession ? SESSION_LINKED_LABEL : SESSION_NONE_LABEL}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {bot.responsibilities.map((responsibility) => (
            <div
              key={responsibility.id}
              data-testid={`responsibility-${responsibility.id}`}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs"
            >
              {responsibility.kind === "scheduled" ? (
                <CalendarClock
                  className="size-3.5 text-muted-foreground"
                  aria-hidden
                />
              ) : (
                <Zap className="size-3.5 text-muted-foreground" aria-hidden />
              )}
              <span>{responsibility.name}</span>
              <Badge variant="outline">
                {responsibility.kind === "scheduled" ? "scheduled" : "reactive"}
              </Badge>
              {responsibility.kind === "scheduled" ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Run ${responsibility.name}`}
                  data-bot-id={bot.id}
                  data-responsibility-id={responsibility.id}
                  disabled={!responsibility.enabled}
                  onClick={() => onRunResponsibility(responsibility.id)}
                >
                  <Play />
                </Button>
              ) : (
                <span className="text-muted-foreground">
                  Event adapter not connected
                </span>
              )}
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            data-testid={`add-responsibility-${bot.id}`}
            onClick={onAddResponsibility}
          >
            <Plus />
            Add responsibility
          </Button>
        </div>
        {expanded ? (
          <div className="space-y-5 border-t border-border pt-4">
            <div data-testid={`bot-automations-${bot.id}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium">Automations</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Scheduled responsibilities running on the daemon
                    scheduler.
                  </p>
                </div>
                <Badge variant="secondary">{automations.length}</Badge>
              </div>
              {automations.length ? (
                <div className="mt-3 space-y-2">
                  {automations.map((automation) => {
                    const automationId =
                      automation.trigger.kind === "scheduled"
                        ? automation.trigger.automationId
                        : null;
                    const lastRun = automationId
                      ? botHistory.find(
                          (entry) =>
                            entry.run.automationId === automationId,
                        )
                      : undefined;
                    return (
                      <div
                        key={automation.id}
                        data-testid={`bot-automation-${automation.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs"
                      >
                        <span className="min-w-0">
                          <span className="font-medium">
                            {automation.name}
                          </span>{" "}
                          <span className="text-muted-foreground">
                            {automation.enabled ? "Active" : "Paused"} ·{" "}
                            {lastRun
                              ? historyDetail(lastRun)
                              : "No runs yet"}
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Run automation ${automation.name}`}
                          disabled={!automation.enabled}
                          onClick={() =>
                            onRunResponsibility(automation.id)
                          }
                        >
                          <Play />
                          Run now
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  No automations yet — add a scheduled responsibility to
                  create one.
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                data-testid={`add-automation-${bot.id}`}
                onClick={onAddResponsibility}
              >
                <Plus />
                Add automation
              </Button>
            </div>
            <div data-testid={`bot-monitors-${bot.id}`}>
              <p className="text-xs font-medium">Monitors</p>
              <p className="mt-1 text-xs text-muted-foreground">
                No monitors yet — monitor rules have no service backing in
                this build, so none are listed and none are claimed.
              </p>
            </div>
          </div>
        ) : null}
        {botHistory.length ? (
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium">Responsibility history</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Links to actual automation runs and Mentu evidence.
                </p>
              </div>
              <Badge variant="secondary">{botHistory.length}</Badge>
            </div>
            {botHistory.length ? (
              <div className="mt-3 space-y-2">
                {botHistory.slice(0, 3).map((entry) => (
                  <div
                    key={entry.run.id}
                    data-testid={`history-${entry.run.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs"
                  >
                    <span>
                      {entry.responsibilityName ?? "Removed responsibility"}
                    </span>
                    <span className="text-muted-foreground">
                      {historyDetail(entry)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default BotResponsibilityCard;
