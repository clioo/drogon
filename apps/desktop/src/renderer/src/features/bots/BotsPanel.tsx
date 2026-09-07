import { createElement } from "react";
import { Button } from "../../components/ui/button";
import type { BotsPanelProps } from "./bots-panel-contracts";
import {
  SESSION_LINKED_LABEL,
  SESSION_NONE_LABEL,
  projectBotRows,
  projectHistoryRows,
  projectResponsibilityRows,
  projectSessionLiveness,
} from "./bots-panel-projection";

// Exported-but-unmounted (V2 mounts). Props only — no store/RPC/session
// access. Styling: admitted main.css tokens + ui primitives, monochrome and
// quiet (STYLEGUIDE at the pinned source, read-only). WHY the wording rules:
// a stored session is a link, never liveness — liveness renders only from the
// caller's observed verdicts; history keeps store order with explicit
// null-join markers because orphaned evidence is retained, never invented;
// reactive duties get no manual run control because the source refuses one;
// there is no create control until the Bot-create service capability lands.

const JOINED = (value: string | number | null): string =>
  value === null || value === "" ? "—" : String(value);

function HistoryRow({
  entry,
}: {
  entry: ReturnType<typeof projectHistoryRows>[number];
}) {
  return createElement(
    "tr",
    { "data-testid": `history-${entry.runId}` },
    createElement(
      "td",
      { className: "border-border py-1 pr-3 text-muted-foreground" },
      entry.runId,
    ),
    createElement(
      "td",
      { className: "border-border py-1 pr-3 text-muted-foreground" },
      entry.responsibilityName ?? "unlinked responsibility",
    ),
    createElement(
      "td",
      { className: "border-border py-1 pr-3 text-muted-foreground" },
      entry.automationName ?? "unlinked automation",
    ),
    createElement(
      "td",
      { className: "border-border py-1 pr-3 text-muted-foreground" },
      JOINED(entry.automationRunNumber),
    ),
    createElement(
      "td",
      { className: "border-border py-1 pr-3 text-muted-foreground" },
      JOINED(entry.hostObservation),
    ),
    createElement(
      "td",
      { className: "border-border py-1 pr-3 text-muted-foreground" },
      JOINED(entry.endedAt),
    ),
  );
}

export function BotsPanel({
  snapshot,
  onRunResponsibility,
  observedLivenessByBotId,
}: BotsPanelProps) {
  const botRows = projectBotRows(snapshot.bots);
  const historyRows = projectHistoryRows(snapshot.history);

  return createElement(
    "section",
    {
      "data-testid": "bots-panel",
      "aria-label": "Bots",
      className: "flex flex-col gap-4 text-foreground",
    },
    createElement(
      "h1",
      {
        className:
          "text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground",
      },
      "Bots",
    ),
    botRows.length === 0
      ? createElement(
          "p",
          {
            "data-testid": "bots-empty",
            className: "text-sm text-muted-foreground",
          },
          "No Bots yet",
        )
      : createElement(
          "ul",
          { className: "flex flex-col gap-3" },
          botRows.map((row) => {
            const owner = snapshot.bots.find((bot) => bot.id === row.id);
            if (!owner) return null;
            const responsibilities = projectResponsibilityRows(owner);
            const observedLiveness = projectSessionLiveness(
              row.id,
              observedLivenessByBotId,
            );
            return createElement(
              "li",
              {
                key: row.id,
                "data-testid": `bot-${row.id}`,
                className: "rounded-md border border-border bg-background p-3",
              },
              createElement(
                "h2",
                { className: "text-sm font-medium text-foreground" },
                row.displayName,
              ),
              row.handle
                ? createElement(
                    "span",
                    { className: "text-xs text-muted-foreground" },
                    `@${row.handle}`,
                  )
                : null,
              createElement(
                "p",
                {
                  "data-testid": `bot-description-${row.id}`,
                  className: "text-sm text-foreground",
                },
                row.description,
              ),
              createElement(
                "p",
                { className: "text-xs text-muted-foreground" },
                `${row.harness} · ${row.modelLabel} · ${
                  row.sessionLink === "linked"
                    ? SESSION_LINKED_LABEL
                    : SESSION_NONE_LABEL
                }`,
                observedLiveness
                  ? ` · Observed liveness: ${observedLiveness}`
                  : "",
              ),
              createElement(
                "ul",
                { className: "mt-2 flex flex-col gap-1" },
                responsibilities.map((item) =>
                  createElement(
                    "li",
                    {
                      key: item.id,
                      "data-testid": `responsibility-${item.id}`,
                      className: "flex items-center gap-2",
                    },
                    createElement(
                      "span",
                      { className: "text-xs text-muted-foreground" },
                      `${item.name} (${item.kind}) · ${item.triggerLabel} · ${
                        item.enabled ? "Enabled" : "Disabled"
                      }${item.recipeRef ? ` · ${item.recipeRef}` : ""}`,
                    ),
                    item.canManualRun && onRunResponsibility
                      ? createElement(
                          Button,
                          {
                            asChild: true,
                            variant: "outline",
                            size: "sm",
                          },
                          // asChild (Radix Slot): the payload attrs + onClick
                          // live on a native button child because the
                          // primitive's TS props don't declare data-* keys;
                          // Slot merges tokens + data-slot onto it.
                          createElement(
                            "button",
                            {
                              type: "button",
                              "data-bot-id": row.id,
                              "data-responsibility-id": item.id,
                              onClick: () =>
                                onRunResponsibility({
                                  botId: row.id,
                                  responsibilityId: item.id,
                                }),
                            },
                            `Run ${item.name}`,
                          ),
                        )
                      : null,
                  ),
                ),
              ),
            );
          }),
        ),
    historyRows.length > 0
      ? createElement(
          "table",
          {
            "data-testid": "bots-history",
            className: "w-full border-collapse text-left text-xs",
          },
          createElement(
            "thead",
            null,
            createElement(
              "tr",
              null,
              [
                "Run",
                "Responsibility",
                "Automation",
                "Automation run",
                "Host observation",
                "Ended",
              ].map((label) =>
                createElement(
                  "th",
                  {
                    key: label,
                    className:
                      "border-border border-b pb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground",
                  },
                  label,
                ),
              ),
            ),
          ),
          createElement(
            "tbody",
            null,
            historyRows.map((entry) =>
              createElement(HistoryRow, { key: entry.runId, entry }),
            ),
          ),
        )
      : null,
  );
}

export default BotsPanel;
