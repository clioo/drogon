import { useEffect, useState } from "react";
import { Bot, Plus, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { BotsPanelProps, BotsPanelSnapshot } from "./bots-panel-contracts";
import {
  SESSION_LINKED_LABEL,
  SESSION_NONE_LABEL,
  projectBotRows,
  projectHistoryRows,
  projectResponsibilityRows,
  projectSessionLiveness,
} from "./bots-panel-projection";
import { BotAvatar } from "./BotAvatar";
import { BotCreationForm } from "./BotCreationForm";
import { BotConversation } from "./BotConversation";
import { buildBotCreateBody, emptyBotCreateForm } from "./bots-page-model";
import type { BotCreateFormValues } from "./bots-page-model";

// Bots page. Props only — no store/RPC/session access beyond the caller-
// supplied `bridge`/`scope` (V2 mounts and owns the single App mount point).
// Styling: admitted main.css tokens + ui primitives, monochrome and quiet.
// WHY the wording rules: a stored session is a link, never liveness —
// liveness renders only from the caller's observed verdicts; history keeps
// store order with explicit null-join markers because orphaned evidence is
// retained, never invented; reactive duties get no manual run control
// because the source refuses one. Create/chat/select all gate on
// `bridge`+`scope` both being present — the same "no control without a real
// capability behind it" rule the run button already followed, so a caller
// that supplies neither renders the exact pre-R2-S read-only view.

const JOINED = (value: string | number | null): string =>
  value === null || value === "" ? "—" : String(value);

function HistoryRow({
  entry,
}: {
  entry: ReturnType<typeof projectHistoryRows>[number];
}) {
  return (
    <tr data-testid={`history-${entry.runId}`}>
      <td className="border-border py-1 pr-3 text-muted-foreground">
        {entry.runId}
      </td>
      <td className="border-border py-1 pr-3 text-muted-foreground">
        {entry.responsibilityName ?? "unlinked responsibility"}
      </td>
      <td className="border-border py-1 pr-3 text-muted-foreground">
        {entry.automationName ?? "unlinked automation"}
      </td>
      <td className="border-border py-1 pr-3 text-muted-foreground">
        {JOINED(entry.automationRunNumber)}
      </td>
      <td className="border-border py-1 pr-3 text-muted-foreground">
        {JOINED(entry.hostObservation)}
      </td>
      <td className="border-border py-1 pr-3 text-muted-foreground">
        {JOINED(entry.endedAt)}
      </td>
    </tr>
  );
}

export function BotsPanel({
  snapshot,
  onRunResponsibility,
  observedLivenessByBotId,
  bridge,
  scope,
  sessionReader,
}: BotsPanelProps) {
  const canMutate = Boolean(bridge && scope);
  const [localSnapshot, setLocalSnapshot] = useState<BotsPanelSnapshot | null>(
    null,
  );
  useEffect(() => {
    setLocalSnapshot(null);
  }, [snapshot]);
  const effective = localSnapshot ?? snapshot;

  async function refreshSnapshot() {
    if (!bridge?.botSnapshot || !scope) return;
    const response = await bridge.botSnapshot(scope);
    if (response.ok) {
      setLocalSnapshot({
        bots: response.result.bots,
        history: response.result.history,
      });
    }
  }

  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] =
    useState<BotCreateFormValues>(emptyBotCreateForm());
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    await refreshSnapshot();
    setLoading(false);
  }

  async function submitCreate() {
    if (!bridge?.botCreate || !scope) return;
    setCreateBusy(true);
    setCreateError(null);
    const response = await bridge.botCreate({
      ...scope,
      requestId:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `bot-create-${Date.now()}`,
      body: buildBotCreateBody(createForm),
    });
    setCreateBusy(false);
    if (!response.ok) {
      setCreateError(response.error.message);
      return;
    }
    setShowCreateForm(false);
    setCreateForm(emptyBotCreateForm());
    setSelectedBotId(response.result.id);
    await refreshSnapshot();
  }

  const botRows = projectBotRows(effective.bots);
  const historyRows = projectHistoryRows(effective.history);

  return (
    <section
      data-testid="bots-panel"
      aria-label="Bots"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">Bots</h1>
          <p className="truncate text-xs text-muted-foreground">
            Your team of agents, with memory and a purpose.
          </p>
        </div>
        {canMutate && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh Bots"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw
              className={loading ? "animate-spin motion-reduce:animate-none" : ""}
            />
          </Button>
        )}
        {canMutate && (
          <Button
            size="sm"
            disabled={showCreateForm || createBusy}
            onClick={() => setShowCreateForm(true)}
          >
            <Plus />
            New Bot
          </Button>
        )}
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-5 sm:p-7">
          {createError && (
            <p role="alert" className="text-sm text-destructive">
              {createError}
            </p>
          )}
          {canMutate && showCreateForm ? (
            <BotCreationForm
              form={createForm}
              busy={createBusy}
              onChange={(updates) =>
                setCreateForm((current) => ({ ...current, ...updates }))
              }
              onCancel={() => setShowCreateForm(false)}
              onSubmit={() => void submitCreate()}
            />
          ) : botRows.length === 0 ? (
            <div
              data-testid="bots-empty"
              className="rounded-lg border border-dashed border-border px-5 py-10 text-center"
            >
              <Bot
                className="mx-auto mb-3 size-8 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-foreground">No Bots yet</p>
              <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
                Give a character a purpose. Its identity and memory stay with
                you across sessions.
              </p>
              {canMutate && (
                <Button
                  className="mt-4"
                  onClick={() => setShowCreateForm(true)}
                >
                  <Plus />
                  Create Bot
                </Button>
              )}
            </div>
          ) : (
            <ul className="flex flex-col gap-3" role="list" aria-label="Bots">
              {botRows.map((row) => {
                const owner = effective.bots.find((bot) => bot.id === row.id);
                if (!owner) return null;
                const responsibilities = projectResponsibilityRows(owner);
                const observedLiveness = projectSessionLiveness(
                  row.id,
                  observedLivenessByBotId,
                );
                const selected = selectedBotId === row.id;
                return (
                  <li
                    key={row.id}
                    data-testid={`bot-${row.id}`}
                    className="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
                  >
                    <div className="flex items-start gap-3">
                      <BotAvatar displayName={row.displayName} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h2 className="text-sm font-medium text-foreground">
                            {row.displayName}
                          </h2>
                          {row.handle && (
                            <span className="text-xs text-muted-foreground">
                              @{row.handle}
                            </span>
                          )}
                        </div>
                        <p
                          data-testid={`bot-description-${row.id}`}
                          className="text-sm text-foreground"
                        >
                          {row.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.harness} · {row.modelLabel} ·{" "}
                          {row.sessionLink === "linked"
                            ? SESSION_LINKED_LABEL
                            : SESSION_NONE_LABEL}
                          {observedLiveness
                            ? ` · Observed liveness: ${observedLiveness}`
                            : ""}
                        </p>
                      </div>
                      {canMutate && (
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid={`select-bot-${row.id}`}
                          onClick={() =>
                            setSelectedBotId(selected ? null : row.id)
                          }
                        >
                          {selected ? "Close chat" : "Chat"}
                        </Button>
                      )}
                    </div>
                    {responsibilities.length > 0 && (
                      <ul className="flex flex-col gap-1">
                        {responsibilities.map((item) => (
                          <li
                            key={item.id}
                            data-testid={`responsibility-${item.id}`}
                            className="flex items-center gap-2"
                          >
                            <span className="text-xs text-muted-foreground">
                              {item.name} ({item.kind}) · {item.triggerLabel} ·{" "}
                              {item.enabled ? "Enabled" : "Disabled"}
                              {item.recipeRef ? ` · ${item.recipeRef}` : ""}
                            </span>
                            {item.canManualRun && onRunResponsibility && (
                              <Button asChild variant="outline" size="sm">
                                {/* asChild (Radix Slot): the payload attrs + onClick
                                live on a native button child because the
                                primitive's TS props don't declare data-*
                                keys; Slot merges tokens + data-slot onto it. */}
                                <button
                                  type="button"
                                  data-bot-id={row.id}
                                  data-responsibility-id={item.id}
                                  onClick={() =>
                                    onRunResponsibility({
                                      botId: row.id,
                                      responsibilityId: item.id,
                                    })
                                  }
                                >
                                  {`Run ${item.name}`}
                                </button>
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {canMutate && selected && scope && bridge && (
                      <BotConversation
                        botId={row.id}
                        harnessId={owner.harnessPolicy.defaultHarness}
                        scope={scope}
                        bridge={bridge}
                        sessionReader={sessionReader}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {historyRows.length > 0 && (
            <table
              data-testid="bots-history"
              className="w-full border-collapse text-left text-xs"
            >
              <thead>
                <tr>
                  {[
                    "Run",
                    "Responsibility",
                    "Automation",
                    "Automation run",
                    "Host observation",
                    "Ended",
                  ].map((label) => (
                    <th
                      key={label}
                      className="border-border border-b pb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {historyRows.map((entry) => (
                  <HistoryRow key={entry.runId} entry={entry} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

export default BotsPanel;
