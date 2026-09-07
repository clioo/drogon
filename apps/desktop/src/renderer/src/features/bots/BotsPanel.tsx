import { useEffect, useState } from "react";
import { ArrowLeft, Bot, Plus, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { BotsPanelProps, BotsPanelSnapshot } from "./bots-panel-contracts";
import {
  projectBotRows,
  projectSessionLiveness,
} from "./bots-panel-projection";
import { BotCreationForm } from "./BotCreationForm";
import { BotConversation } from "./BotConversation";
import { BotResponsibilityCard } from "./BotResponsibilityCard";
import { ResponsibilityFormCard } from "./BotsPageForms";
import {
  buildBotCreateBody,
  emptyBotCreateForm,
  emptyResponsibilityForm,
} from "./bots-page-model";
import type {
  BotCreateFormValues,
  ResponsibilityFormValues,
} from "./bots-page-model";

// Bots page. Props only — no store/RPC/session access beyond the caller-
// supplied `bridge`/`scope` (V2 mounts and owns the single App mount point).
// Styling: admitted main.css tokens + ui primitives, monochrome and quiet.
// List rows are the fork's BotResponsibilityCard chrome (ported); selecting
// a bot opens a detail view (Back button, card, conversation, add form).
// WHY the wording rules: a stored session is a link, never liveness —
// liveness renders only from the caller's observed verdicts; orphaned
// history keeps explicit null-join markers because orphaned evidence is
// retained, never invented; reactive duties get no manual run control
// because the source refuses one. Create/chat/add/delete all gate on
// `bridge`+`scope` both being present — the same "no control without a real
// capability behind it" rule the run button already followed, so a caller
// that supplies neither renders the exact pre-R2-S read-only view.

function mintRequestId(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}`;
}

export function BotsPanel({
  snapshot,
  onClose,
  onRunResponsibility,
  observedLivenessByBotId,
  bridge,
  scope,
  sessionReader,
}: BotsPanelProps) {
  const canMutate = Boolean(bridge && scope);
  // Add/delete gate on their own bridge methods, not bare scope: a caller
  // whose bridge predates R7-E renders the read-only card (same rule the
  // run button already follows with onRunResponsibility).
  const canEditResponsibilities = Boolean(
    bridge?.botResponsibilityCreate && bridge?.botResponsibilityDelete && scope,
  );
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
  const [showResponsibilityForm, setShowResponsibilityForm] = useState(false);
  const [responsibilityForm, setResponsibilityForm] =
    useState<ResponsibilityFormValues>(emptyResponsibilityForm());
  const [responsibilityBusy, setResponsibilityBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
      requestId: mintRequestId("bot-create"),
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

  async function submitResponsibility(botId: string) {
    if (!bridge?.botResponsibilityCreate || !scope) return;
    setResponsibilityBusy(true);
    setActionError(null);
    const response = await bridge.botResponsibilityCreate({
      ...scope,
      requestId: mintRequestId("bot-responsibility"),
      botId,
      name: responsibilityForm.name.trim(),
      schedule: responsibilityForm.cron.trim(),
      prompt: responsibilityForm.prompt,
    });
    setResponsibilityBusy(false);
    if (!response.ok) {
      setActionError(response.error.message);
      return;
    }
    setShowResponsibilityForm(false);
    setResponsibilityForm(emptyResponsibilityForm());
    await refreshSnapshot();
  }

  async function deleteResponsibility(botId: string, responsibilityId: string) {
    if (!bridge?.botResponsibilityDelete || !scope) return;
    setActionError(null);
    const response = await bridge.botResponsibilityDelete({
      ...scope,
      requestId: mintRequestId("bot-responsibility"),
      botId,
      responsibilityId,
    });
    if (!response.ok) {
      setActionError(response.error.message);
      return;
    }
    await refreshSnapshot();
  }

  function closeDetail() {
    setSelectedBotId(null);
    setShowResponsibilityForm(false);
    setActionError(null);
  }

  const botRows = projectBotRows(effective.bots);
  const selectedBot =
    selectedBotId !== null
      ? (effective.bots.find((bot) => bot.id === selectedBotId) ?? null)
      : null;

  return (
    <section
      data-testid="bots-panel"
      aria-label="Bots"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        {onClose ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="shrink-0 gap-1.5"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Button>
        ) : null}
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
          {actionError && (
            <div
              className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {actionError}
            </div>
          )}
          {selectedBot ? (
            <div data-testid="bot-detail" className="flex flex-col gap-4">
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="bot-detail-back"
                  onClick={closeDetail}
                  className="gap-1.5"
                >
                  <ArrowLeft className="size-3.5" />
                  Back
                </Button>
              </div>
              <BotResponsibilityCard
                bot={selectedBot}
                history={effective.history}
                observedLiveness={projectSessionLiveness(
                  selectedBot.id,
                  observedLivenessByBotId,
                )}
                onAddResponsibility={
                  canEditResponsibilities
                    ? () => setShowResponsibilityForm(true)
                    : undefined
                }
                onDeleteResponsibility={
                  canEditResponsibilities
                    ? (responsibilityId) =>
                        void deleteResponsibility(
                          selectedBot.id,
                          responsibilityId,
                        )
                    : undefined
                }
                onRunResponsibility={
                  onRunResponsibility
                    ? (responsibilityId) =>
                        onRunResponsibility({
                          botId: selectedBot.id,
                          responsibilityId,
                        })
                    : undefined
                }
              />
              {canMutate && scope && bridge && (
                <BotConversation
                  botId={selectedBot.id}
                  harnessId={selectedBot.harnessPolicy.defaultHarness}
                  scope={scope}
                  bridge={bridge}
                  sessionReader={sessionReader}
                />
              )}
              {canEditResponsibilities && showResponsibilityForm ? (
                <ResponsibilityFormCard
                  form={responsibilityForm}
                  busy={responsibilityBusy}
                  onChange={(updates) =>
                    setResponsibilityForm((current) => ({
                      ...current,
                      ...updates,
                    }))
                  }
                  onCancel={() => setShowResponsibilityForm(false)}
                  onSubmit={() => void submitResponsibility(selectedBot.id)}
                />
              ) : null}
            </div>
          ) : canMutate && showCreateForm ? (
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
            <div className="space-y-4" role="list" aria-label="Bots">
              {botRows.map((row) => {
                const owner = effective.bots.find((bot) => bot.id === row.id);
                if (!owner) return null;
                return (
                  <div key={row.id} role="listitem">
                    <BotResponsibilityCard
                      bot={owner}
                      history={effective.history}
                      observedLiveness={projectSessionLiveness(
                        row.id,
                        observedLivenessByBotId,
                      )}
                      onOpenSession={
                        canMutate
                          ? () => setSelectedBotId(row.id)
                          : undefined
                      }
                      onAddResponsibility={
                        canEditResponsibilities
                          ? () => {
                              setSelectedBotId(row.id);
                              setShowResponsibilityForm(true);
                            }
                          : undefined
                      }
                      onDeleteResponsibility={
                        canEditResponsibilities
                          ? (responsibilityId) =>
                              void deleteResponsibility(
                                row.id,
                                responsibilityId,
                              )
                          : undefined
                      }
                      onRunResponsibility={
                        onRunResponsibility
                          ? (responsibilityId) =>
                              onRunResponsibility({
                                botId: row.id,
                                responsibilityId,
                              })
                          : undefined
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default BotsPanel;
