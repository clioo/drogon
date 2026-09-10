// MIT Copyright (c) 2026 Lovecast Inc.
// C11: the local Bot picker for a task — clearly a Drogon-local assignment,
// visually and copy-wise separate from Jira's remote assignee picker. The
// popover reuses this repo's picker DOM language (Popover + flat option
// rows); the runtime calls are props (onAssign/onClear) so the component
// stays transport-free until the held preload/shared seams land. Assignment
// alone never runs the Bot: opening a conversation or running a turn is a
// separate explicit action downstream.
import { Bot, LoaderCircle, UserRoundX } from "lucide-react";
import * as React from "react";

import { Button } from "../../../components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import {
  assignmentStatus,
  type BotAssignmentOption,
  type TaskBotAssignment,
} from "./bot-assignment-state";

export function BotAssignmentPicker({
  assignment,
  bots,
  onAssign,
  onClear,
  busy = false,
  label = "Local Bot",
}: {
  assignment: TaskBotAssignment | null | undefined;
  /** Host-scoped local Bots (from `botSnapshot`), not Jira users. */
  bots: readonly BotAssignmentOption[];
  /** `(botId, expectedVersion)` — expectedVersion is the CAS handle from the
   * last read; null asserts the task is currently unassigned. */
  onAssign: (botId: string, expectedVersion: number | null) => void;
  /** `(expectedVersion)` — clear the assignment, keeping history. */
  onClear: (expectedVersion: number | null) => void;
  busy?: boolean;
  label?: string;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const status = assignmentStatus(assignment);
  const currentName = status.kind === "unassigned" ? null : status.botName;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={busy}
          aria-label={`${label}: ${currentName ?? "none assigned"}`}
          className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2 text-left text-[12px] transition hover:bg-muted/40 disabled:opacity-50"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Bot
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span
              className={
                currentName ? "truncate" : "truncate text-muted-foreground"
              }
            >
              {currentName ?? `Assign ${label}`}
            </span>
          </span>
          {busy ? (
            <LoaderCircle
              className="size-3 shrink-0 animate-spin"
              aria-hidden
            />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="popover-scroll-content scrollbar-sleek w-64 p-1"
        align="start"
      >
        <div className="px-2 py-1.5">
          <p className="text-[12px] font-medium text-foreground">{label}</p>
          <p className="text-[11px] text-muted-foreground">
            Drogon-local assignment. The Jira assignee is never changed.
          </p>
        </div>
        {status.kind === "bot-deleted" ? (
          <div
            role="alert"
            className="mx-1 mb-1 rounded-sm border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
          >
            {status.botName} no longer exists. Assign a different Bot or
            unassign — history is kept.
          </div>
        ) : null}
        <div role="listbox" aria-label={`${label} options`}>
          {bots.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-muted-foreground">
              No local Bots yet.
            </p>
          ) : (
            bots.map((bot) => {
              const selected =
                status.kind !== "unassigned" && status.botId === bot.id;
              return (
                <button
                  key={bot.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-disabled={bot.disabled || undefined}
                  disabled={bot.disabled}
                  onClick={() => {
                    if (bot.disabled) {
                      return;
                    }
                    onAssign(
                      bot.id,
                      status.kind === "unassigned" ? null : status.version,
                    );
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-accent disabled:opacity-50"
                >
                  <Bot
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{bot.name}</span>
                    {bot.disabledReason ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {bot.disabledReason}
                      </span>
                    ) : null}
                  </span>
                  {selected ? (
                    <span className="text-[11px] text-muted-foreground">
                      assigned
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
        {status.kind !== "unassigned" ? (
          <div className="mt-1 border-t border-border/40 pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-[12px] text-muted-foreground hover:text-foreground"
              disabled={busy}
              onClick={() => {
                onClear(status.version);
                setOpen(false);
              }}
            >
              <UserRoundX className="size-3.5" aria-hidden />
              Unassign Bot
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
