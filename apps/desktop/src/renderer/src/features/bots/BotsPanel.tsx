import { createElement } from "react";
import type { BotsPanelProps } from "./bots-panel-contracts";
import {
  SESSION_LINKED_LABEL,
  SESSION_NONE_LABEL,
  projectBotRows,
  projectHistoryRows,
  projectResponsibilityRows,
  projectSessionLiveness,
} from "./bots-panel-projection";

// Exported-but-unmounted Bots panel (V2 owns App mounting). Reads only
// caller-supplied props: no store, RPC, session or mounting access here.
// Storage contracts: crates/drogon-core/src/bots + automations records via
// docs/migration/native-bot-state-contract.md. History rows are rendered in
// the order supplied by the caller (the store provides newest-first) and keep
// orphaned evidence visible through explicit null-join markers; host
// observations are rendered verbatim as evidence labels, never as a success
// status. A stored session is rendered as a link ("Session linked"), never as
// liveness — liveness appears only when the caller supplies an observed
// verdict (live | unverifiable | exited), rendered verbatim. There is no
// create control until the Bot-create service capability lands. Reactive
// responsibilities render without a manual run control — the manual
// scheduled-run path must keep refusing reactive work (source B-reactive), so
// no such control is offered.

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
    createElement("td", null, entry.runId),
    createElement(
      "td",
      null,
      entry.responsibilityName ?? "unlinked responsibility",
    ),
    createElement("td", null, entry.automationName ?? "unlinked automation"),
    createElement("td", null, JOINED(entry.automationRunNumber)),
    createElement("td", null, JOINED(entry.hostObservation)),
    createElement("td", null, JOINED(entry.endedAt)),
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
    { "data-testid": "bots-panel", "aria-label": "Bots" },
    createElement("h1", null, "Bots"),
    botRows.length === 0
      ? createElement("p", { "data-testid": "bots-empty" }, "No Bots yet")
      : createElement(
          "ul",
          null,
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
              { key: row.id, "data-testid": `bot-${row.id}` },
              createElement("h2", null, row.displayName),
              row.handle ? createElement("span", null, `@${row.handle}`) : null,
              createElement(
                "p",
                { "data-testid": `bot-description-${row.id}` },
                row.description,
              ),
              createElement(
                "p",
                null,
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
                null,
                responsibilities.map((item) =>
                  createElement(
                    "li",
                    {
                      key: item.id,
                      "data-testid": `responsibility-${item.id}`,
                    },
                    createElement(
                      "span",
                      null,
                      `${item.name} (${item.kind}) · ${item.triggerLabel} · ${
                        item.enabled ? "Enabled" : "Disabled"
                      }${item.recipeRef ? ` · ${item.recipeRef}` : ""}`,
                    ),
                    item.canManualRun && onRunResponsibility
                      ? createElement(
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
          { "data-testid": "bots-history" },
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
              ].map((label) => createElement("th", { key: label }, label)),
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
