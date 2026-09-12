/* MIT Copyright (c) 2026 Lovecast Inc.
 * The Bots card rebuilt to the OWNER'S DESIGN (task_197f6a7eb370 — "los
 * bots no se ven como el diseño que te había pasado"): square avatar tile,
 * name + handle chip + coloured status pill, description, right-aligned
 * primary "Open session" with a play glyph and a trash icon button, three
 * bordered info tiles (HARNESS / MODEL POLICY / SESSION), a
 * "Responsibilities:" chip row with a dashed add chip, a BOT WORKSPACE
 * strip with the real provisioned path, and a two-column body —
 * AUTOMATIONS (real scheduler records joined by automationId) and
 * MONITORS (durable `bot.monitor_list` rows).
 * Honesty contract: every value renders from stored facts. The workspace
 * strip is omitted until the daemon has provisioned the bot's home; the
 * harness version marker from the mockup is omitted because no harness
 * version ships in this build's data; the monitors' "Test" control is
 * omitted because the only test RPC belongs to the bot's own self API.
 * `data-testid` hooks stay: the packaged probes and contract tests
 * address the card through them (bot-*, open-session-*, delete-bot-*,
 * add-responsibility-*, responsibility-*, add-automation-*, history-*).
 * The collapsed row (a bot with nothing configured) keeps a working
 * "+ Add" control whose accessible name is "Add responsibility" so the
 * create-then-configure journey stays one click deep. */

import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  FolderLock,
  Lock,
  Play,
  Plus,
  RotateCcw,
  SquareTerminal,
  Trash2,
  Zap,
} from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import type { AutomationSummary } from "../../../../shared/automation-contract";
import type {
  BotsPanelBot,
  BotsPanelHistoryEntry,
  BotsPanelHostObservation,
  BotMonitorView,
} from "./bots-panel-contracts";
import {
  HARNESS_DEFAULT_MODEL_LABEL,
  SESSION_LINKED_LABEL,
  SESSION_NONE_LABEL,
  botDescription,
} from "./bots-panel-projection";
import {
  botInitials,
  botStatusPill,
  collapsedRowNote,
  isBotUnconfigured,
} from "./bots-page-model";
import { DrogonBotAvatar } from "./DrogonBotAvatar";
import { botHarnessLabel } from "./bots-page-model";
import type { DrogonBotCharacterPreset } from "./bot-characters";
import { AgentIcon } from "../settings/agent-catalog";
import { BotAutomationCardItem } from "./BotAutomationCardItem";
import { BotMonitorCardItem } from "./BotMonitorCardItem";

const STATUS_PILL_STYLES: Record<
  "ready" | "idle" | "live",
  { dot: string; text: string }
> = {
  ready: { dot: "bg-emerald-500", text: "text-foreground" },
  idle: { dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
  live: { dot: "bg-emerald-500", text: "text-foreground" },
};

function InfoTile({
  label,
  icon,
  trailing,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {trailing ? (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {trailing}
          </span>
        ) : null}
      </div>
      <div className="mt-1 truncate text-sm font-medium text-foreground">
        {children}
      </div>
    </div>
  );
}

export function BotResponsibilityCard({
  bot,
  history,
  automationsById,
  monitors,
  busy = false,
  observedLiveness,
  expanded,
  onToggleExpanded,
  onAddResponsibility,
  onDelete,
  onRunResponsibility,
  onLaunch,
  onLaunchNew,
  onApproveMonitor,
}: {
  bot: BotsPanelBot;
  history: BotsPanelHistoryEntry[];
  /** Real scheduler records joined by automationId (host-supplied
   *  `automation.list`). Null means no automation data source this
   *  session; the automations column then renders the bot record's own
   *  fields only. */
  automationsById: Map<string, AutomationSummary> | null;
  /** Durable monitors from `bot.monitor_list`. Null means no monitor data
   *  source; the column says so instead of claiming an empty watch. */
  monitors: BotMonitorView[] | null;
  /** Shared busy gate (a mutation is in flight): automation Run buttons
   *  disable while it lasts, exactly like the controller's own gate. */
  busy?: boolean;
  observedLiveness?: BotsPanelHostObservation;
  expanded: boolean;
  onToggleExpanded: () => void;
  onAddResponsibility: () => void;
  onDelete: () => void;
  onRunResponsibility: (responsibilityId: string) => void;
  onLaunch: () => void;
  /** Gap 2: explicit "start a fresh session", shown only when the Bot has
   *  a recorded session that "Open session" would otherwise resume. */
  onLaunchNew?: () => void;
  /** Parked-watch approval: arms the monitor's CURRENT rule text through
   *  the daemon's hash-bound `bot.monitor_approve` (the only approval
   *  path — never a second one). */
  onApproveMonitor?: (monitorId: string) => void;
}): React.JSX.Element {
  const botHistory = history.filter((entry) => entry.run.botId === bot.id);
  const scheduled = bot.responsibilities.filter(
    (responsibility) => responsibility.kind === "scheduled",
  );
  const monitorCount = monitors?.length ?? 0;
  const unconfigured = isBotUnconfigured(bot, monitorCount);
  const status = botStatusPill({
    bot,
    monitorCount,
    observedLiveness,
  });
  const statusStyle = STATUS_PILL_STYLES[status.tone];
  const description = botDescription(bot);

  // Collapsed row: the design's compact rendering. Default-collapsed for
  // a bot with nothing configured; any bot can be collapsed explicitly.
  // Every control below stays real — "+ Add" opens the responsibility
  // form, the chevron expands the full card.
  if (!expanded) {
    const note = unconfigured
      ? collapsedRowNote(bot)
      : [
          scheduled.length === 1
            ? "1 automation"
            : `${scheduled.length} automations`,
          monitorCount === 1
            ? "1 monitor"
            : `${monitorCount} monitor${monitorCount === 0 ? "s" : ""}`,
        ].join(" · ");
    return (
      <Card
        data-testid={`bot-${bot.id}`}
        className="gap-0 py-3"
      >
        <div className="flex flex-wrap items-center gap-3 px-4">
          <DrogonBotAvatar
            preset={bot.characterPreset as DrogonBotCharacterPreset}
            alt={`${bot.displayIdentity.displayName} avatar`}
            className="size-9 rounded-lg"
            initials={botInitials(bot.displayIdentity.displayName)}
          />
          <span className="truncate text-sm font-semibold">
            {bot.displayIdentity.displayName}
          </span>
          {bot.displayIdentity.handle ? (
            <Badge variant="outline" className="font-mono">
              @{bot.displayIdentity.handle}
            </Badge>
          ) : null}
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden
              className={`size-2 rounded-full ${statusStyle.dot}`}
            />
            {status.label}
          </span>
          <span className="w-full truncate text-xs text-muted-foreground sm:w-auto sm:flex-1">
            {note}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              data-testid={`add-responsibility-${bot.id}`}
              aria-label="Add responsibility"
              onClick={onAddResponsibility}
            >
              <Plus />
              Add
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid={`bot-expand-${bot.id}`}
              aria-expanded={expanded}
              aria-label={`Show ${bot.displayIdentity.displayName} details`}
              onClick={onToggleExpanded}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card data-testid={`bot-${bot.id}`} className="gap-0 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <DrogonBotAvatar
            preset={bot.characterPreset as DrogonBotCharacterPreset}
            alt={`${bot.displayIdentity.displayName} avatar`}
            className="size-12 rounded-lg"
            initials={botInitials(bot.displayIdentity.displayName)}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold">
                {bot.displayIdentity.displayName}
              </h2>
              {bot.displayIdentity.handle ? (
                <Badge variant="outline" className="font-mono">
                  @{bot.displayIdentity.handle}
                </Badge>
              ) : null}
              <span
                data-testid={`bot-status-${bot.id}`}
                className={`flex items-center gap-1.5 text-xs ${statusStyle.text}`}
              >
                <span
                  aria-hidden
                  className={`size-2 rounded-full ${statusStyle.dot}`}
                />
                {status.label}
              </span>
            </div>
            <p
              className="mt-1 line-clamp-2 text-sm text-muted-foreground"
              data-testid={`bot-description-${bot.id}`}
            >
              {description}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            data-testid={`open-session-${bot.id}`}
            onClick={onLaunch}
          >
            <Play />
            Open session
          </Button>
          {bot.currentSession && onLaunchNew ? (
            // Gap 2: a Bot is bound to one session, so the default click
            // resumes. This small secondary control is the explicit way to
            // start a fresh one without hiding that default.
            <Button
              variant="outline"
              size="icon-sm"
              data-testid={`new-session-${bot.id}`}
              aria-label="New session"
              onClick={onLaunchNew}
            >
              <RotateCcw />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid={`delete-bot-${bot.id}`}
            aria-label={`Delete ${bot.displayIdentity.displayName}`}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid={`bot-expand-${bot.id}`}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} ${bot.displayIdentity.displayName} details`}
            onClick={onToggleExpanded}
          >
            <ChevronDown
              className={`transition-transform ${expanded ? "" : "rotate-[-90deg]"}`}
              aria-hidden
            />
          </Button>
        </div>
      </div>

      <div className="space-y-5 px-5 pt-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <InfoTile
            label="Harness"
            icon={
              <SquareTerminal
                className="size-3.5 text-muted-foreground"
                aria-hidden
              />
            }
          >
            <span className="flex items-center gap-1.5">
              <AgentIcon
                agent={bot.harnessPolicy.defaultHarness as "claude"}
                size={14}
              />
              {botHarnessLabel(bot.harnessPolicy.defaultHarness)}
            </span>
          </InfoTile>
          <InfoTile label="Model policy">
            {bot.harnessPolicy.explicitModel ?? HARNESS_DEFAULT_MODEL_LABEL}
          </InfoTile>
          <InfoTile label="Session">
            {bot.currentSession ? (
              SESSION_LINKED_LABEL
            ) : (
              <span className="italic text-muted-foreground">
                {SESSION_NONE_LABEL}
              </span>
            )}
          </InfoTile>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">Responsibilities:</p>
          {bot.responsibilities.map((responsibility) => (
            <div
              key={responsibility.id}
              data-testid={`responsibility-${responsibility.id}`}
              className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs"
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
              {responsibility.kind === "scheduled" ? (
                <span className="text-muted-foreground">scheduled</span>
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
            className="border-dashed"
            data-testid={`add-responsibility-${bot.id}`}
            onClick={onAddResponsibility}
          >
            <Plus />
            Add responsibility
          </Button>
        </div>

        {bot.home ? (
          <div
            data-testid={`bot-workspace-${bot.id}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5"
          >
            <FolderLock
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
              Bot workspace
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="size-3" aria-hidden />
              Dedicated folder · separate from project workspaces
            </span>
            <code className="ml-auto max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {bot.home.path}
            </code>
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <section
            data-testid={`bot-automations-${bot.id}`}
            aria-label="Automations"
            className="min-w-0 space-y-3"
          >
            <div className="flex items-center gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Automations
              </h3>
              <Badge variant="secondary">
                {scheduled.length} active
              </Badge>
              <Button
                variant="ghost"
                size="xs"
                className="ml-auto"
                data-testid={`add-automation-${bot.id}`}
                onClick={onAddResponsibility}
              >
                <Plus />
                Add automation
              </Button>
            </div>
            {scheduled.length ? (
              scheduled.map((responsibility) => {
                const automationId =
                  responsibility.trigger.kind === "scheduled"
                    ? responsibility.trigger.automationId
                    : null;
                const automation = automationId
                  ? (automationsById?.get(automationId) ?? null)
                  : null;
                const automationHistory = automationId
                  ? botHistory.filter(
                      (entry) => entry.run.automationId === automationId,
                    )
                  : [];
                return (
                  <BotAutomationCardItem
                    key={responsibility.id}
                    responsibility={responsibility}
                    botId={bot.id}
                    automation={automation}
                    history={automationHistory}
                    busy={busy}
                    onRun={() => onRunResponsibility(responsibility.id)}
                  />
                );
              })
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                No automations yet — add a scheduled responsibility to create
                one.
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full border-dashed"
              data-testid={`add-automation-bottom-${bot.id}`}
              onClick={onAddResponsibility}
            >
              <Plus />
              Add an automation
            </Button>
          </section>

          <section
            data-testid={`bot-monitors-${bot.id}`}
            aria-label="Monitors"
            className="min-w-0 space-y-3"
          >
            <div className="flex items-center gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Monitors
              </h3>
              <Badge variant="secondary">
                {monitorCount} watching
              </Badge>
            </div>
            {monitors === null ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                Monitor details are unavailable in this session — the daemon
                bridge does not expose the monitor read.
              </p>
            ) : monitors.length ? (
              monitors.map((monitor) => (
                <BotMonitorCardItem
                  key={monitor.monitorId}
                  monitor={monitor}
                  responsibilityName={
                    bot.responsibilities.find(
                      (responsibility) =>
                        responsibility.id === monitor.responsibilityId,
                    )?.name ?? null
                  }
                  botDisplayName={bot.displayIdentity.displayName}
                  approving={busy}
                  onApprove={
                    onApproveMonitor
                      ? () => onApproveMonitor(monitor.monitorId)
                      : undefined
                  }
                />
              ))
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                No monitors yet.
              </p>
            )}
          </section>
        </div>
      </div>
    </Card>
  );
}

export default BotResponsibilityCard;
