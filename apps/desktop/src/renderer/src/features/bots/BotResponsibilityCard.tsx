/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/BotResponsibilityCard.tsx.
   Adapters for this repo: the source's Card/CardHeader/CardContent/Badge
   primitives do not exist here (components/ui has button/input only), so
   the same structure renders as bordered divs with a badge-like span using
   admitted main.css tokens; DrogonBotAvatar (character images) is replaced
   by the initials BotAvatar (see BotAvatar.tsx); getAgentLabel is the local
   botHarnessLabel; the source's `history` is the full snapshot history and
   the card filters per bot exactly like the source. The source deletes the
   bot immediately from its header Delete; here Delete opens the inline
   confirm dialog below (the source has no confirm copy, so the copy states
   this repo's own native `bot.delete` effects) and each responsibility
   row gains a Delete control wired to `bot.responsibility_delete`. */

import { useEffect, useId, useState } from "react";
import { CalendarClock, Play, Plus, Zap } from "lucide-react";
import { Button } from "../../components/ui/button";
import type {
  BotsPanelBot,
  BotsPanelHistoryEntry,
  BotsPanelHostObservation,
} from "./bots-panel-contracts";
import {
  SESSION_LINKED_LABEL,
  SESSION_NONE_LABEL,
  botDescription,
  historyTriggerLabel,
  modelLabel,
  triggerLabel,
} from "./bots-panel-projection";
import { BotAvatar } from "./BotAvatar";
import { botHarnessLabel } from "./bots-page-model";

function kindIcon(kind: "reactive" | "scheduled") {
  return kind === "scheduled" ? (
    <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden="true" />
  ) : (
    <Zap className="size-3.5 text-muted-foreground" aria-hidden="true" />
  );
}

/** Right-hand evidence line for one history row. The snapshot join carries
 *  names and the automation run number (never a status verdict): an
 *  automation-linked row names it, else a Mentu run id, else a bare
 *  recorded marker. Orphaned rows (deleted responsibility/automation)
 *  keep their null joins visible, never invented. */
function historyDetail(entry: BotsPanelHistoryEntry): string {
  if (entry.automationRunNumber !== null && entry.automationRunNumber !== undefined) {
    return `${entry.automationName ?? "automation"} · run ${entry.automationRunNumber}`;
  }
  if (entry.run.recipe?.runId) {
    return `Mentu run ${entry.run.recipe.runId}`;
  }
  return "Recorded";
}

/** Inline confirm for the header bot Delete. Pure (no hooks of its own
 *  besides `useId` for ARIA wiring) so tests render it directly. The
 *  source deletes immediately with no confirm; the copy here states this
 *  repo's native `bot.delete` effects instead. */
export function BotDeleteConfirmDialog({
  botName,
  onConfirm,
  onCancel,
}: {
  botName: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-testid="bot-delete-confirm"
      className="mt-3 rounded-md border border-border bg-muted/50 px-3 py-2"
    >
      <p id={titleId} className="text-sm font-medium">
        Delete &ldquo;{botName}&rdquo;?
      </p>
      <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
        This removes the bot, its responsibilities and their scheduled
        automations. Past runs stay in history.
      </p>
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="default" size="sm" onClick={onConfirm}>
          Delete
        </Button>
      </div>
    </div>
  );
}

export function BotResponsibilityCard({
  bot,
  history,
  observedLiveness,
  onOpenSession,
  onAddResponsibility,
  onDeleteBot,
  onDeleteResponsibility,
  onRunResponsibility,
}: {
  bot: BotsPanelBot;
  history: BotsPanelHistoryEntry[];
  observedLiveness?: BotsPanelHostObservation | null;
  onOpenSession?: () => void;
  onAddResponsibility?: () => void;
  /** Header bot delete (`bot.delete`); the card confirms first. Rendered
   *  only when supplied, like every other mutation control here. */
  onDeleteBot?: () => void;
  onDeleteResponsibility?: (responsibilityId: string) => void;
  onRunResponsibility?: (responsibilityId: string) => void;
}): React.JSX.Element {
  const botHistory = history.filter((entry) => entry.run.botId === bot.id);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => {
    setConfirmingDelete(false);
  }, [bot.id]);
  return (
    <div
      data-testid={`bot-${bot.id}`}
      className="rounded-xl border border-border bg-background text-foreground"
    >
      <div className="border-b border-border">
        <div className="flex items-start justify-between gap-3 p-6 pb-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <BotAvatar displayName={bot.displayIdentity.displayName} size={9} />
              <span className="truncate">{bot.displayIdentity.displayName}</span>
              {bot.characterPreset !== "none" ? (
                <span className="rounded-md border border-border px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {bot.characterPreset}
                </span>
              ) : null}
            </h2>
            <p
              data-testid={`bot-description-${bot.id}`}
              className="mt-2 text-sm text-muted-foreground"
            >
              {botDescription(bot)}
              {bot.displayIdentity.handle
                ? ` · @${bot.displayIdentity.handle}`
                : ""}
            </p>
            {onOpenSession ? (
              <Button
                className="mt-3"
                variant="outline"
                size="sm"
                data-testid={`open-session-${bot.id}`}
                onClick={onOpenSession}
              >
                <Play />
                Open session
              </Button>
            ) : null}
          </div>
          {onDeleteBot ? (
            <Button
              variant="ghost"
              size="sm"
              data-testid={`delete-bot-${bot.id}`}
              aria-label={`Delete ${bot.displayIdentity.displayName}`}
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </Button>
          ) : null}
        </div>
        {onDeleteBot && confirmingDelete ? (
          <div className="px-6 pb-4">
            <BotDeleteConfirmDialog
              botName={bot.displayIdentity.displayName}
              onConfirm={() => {
                setConfirmingDelete(false);
                onDeleteBot();
              }}
              onCancel={() => setConfirmingDelete(false)}
            />
          </div>
        ) : null}
      </div>
      <div className="space-y-5 p-6 pt-6">
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
              {modelLabel(bot.harnessPolicy)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Session</p>
            <p className="mt-1 font-medium">
              {bot.currentSession !== null
                ? SESSION_LINKED_LABEL
                : SESSION_NONE_LABEL}
              {observedLiveness
                ? ` · Observed liveness: ${observedLiveness}`
                : ""}
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
              {kindIcon(responsibility.kind)}
              <span>{responsibility.name}</span>
              <span className="rounded-md border border-border px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                {responsibility.kind === "scheduled" ? "scheduled" : "reactive"}
              </span>
              <span className="font-mono text-muted-foreground">
                {triggerLabel(responsibility.trigger)}
              </span>
              {responsibility.kind === "scheduled" ? (
                onRunResponsibility ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Run ${responsibility.name}`}
                    data-bot-id={bot.id}
                    data-responsibility-id={responsibility.id}
                    disabled={!responsibility.enabled}
                    onClick={() => onRunResponsibility(responsibility.id)}
                  >
                    <Play />
                  </Button>
                ) : null
              ) : (
                <span className="text-muted-foreground">
                  Event adapter not connected
                </span>
              )}
              {onDeleteResponsibility ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${responsibility.name}`}
                  data-testid={`delete-responsibility-${responsibility.id}`}
                  data-bot-id={bot.id}
                  data-responsibility-id={responsibility.id}
                  onClick={() => onDeleteResponsibility(responsibility.id)}
                >
                  Delete
                </Button>
              ) : null}
            </div>
          ))}
          {onAddResponsibility ? (
            <Button
              variant="outline"
              size="sm"
              data-testid={`add-responsibility-${bot.id}`}
              onClick={onAddResponsibility}
            >
              <Plus />
              Add responsibility
            </Button>
          ) : null}
        </div>
        {botHistory.length > 0 ? (
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium">Responsibility history</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Links to actual automation runs and Mentu evidence.
                </p>
              </div>
              <span className="rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
                {botHistory.length}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {botHistory.slice(0, 3).map((entry) => (
                <div
                  key={entry.run.id}
                  data-testid={`history-${entry.run.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs"
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span>
                      {entry.responsibilityName ?? "Removed responsibility"}
                    </span>
                    <span className="rounded-md border border-border px-1.5 py-0.5 font-medium text-muted-foreground">
                      {historyTriggerLabel(entry.run.invocation)}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {historyDetail(entry)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default BotResponsibilityCard;
