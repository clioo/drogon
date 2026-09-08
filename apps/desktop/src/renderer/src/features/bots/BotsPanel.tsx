/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/BotsPage.tsx (page composition: header
   with Back/title/refresh/New Bot, action-error alert, create form, then
   loading / error / list / empty states). Adaptation below is structural
   only where noted (detail view, read-only gates); the root is the fork's
   `<main>`, never wrapped in an outer region. */
import { ArrowLeft, Plus, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { BotsPanelProps } from "./bots-panel-contracts";
import {
  projectBotRows,
  projectSessionLiveness,
} from "./bots-panel-projection";
import { BotCreationForm } from "./BotCreationForm";
import { BotConversation } from "./BotConversation";
import { BotResponsibilityCard } from "./BotResponsibilityCard";
import { ResponsibilityFormCard } from "./BotsPageForms";
import {
  BotLoadingState,
  BotsEmptyState,
  BotsErrorState,
} from "./BotsPageStates";
import { useBotsPageController } from "./use-bots-page-controller";

// Bots page. Props only — no store/RPC/session access beyond the caller-
// supplied `bridge`/`scope` (V2 mounts and owns the single App mount point).
// Composition follows the fork's BotsPage.tsx: header (Back, title, refresh,
// New Bot), action-error alert, create form, then loading / error / list /
// empty states, with the responsibility form under the selected bot.
// Styling: admitted main.css tokens + ui primitives, monochrome and quiet.
// Selecting a bot opens a detail view (Back button, card, conversation, add
// form) — the fork's selection ring has no detail to open into, so selection
// navigates here instead; the controller semantics (selection, reload after
// mutations, error alerts, Escape) are the fork's.
// WHY the wording rules: a stored session is a link, never liveness —
// liveness renders only from the caller's observed verdicts; orphaned
// history keeps explicit null-join markers because orphaned evidence is
// retained, never invented; reactive duties get no manual run control
// because the source refuses one. Create/chat/add/delete all gate on
// `bridge`+`scope` both being present — the same "no control without a real
// capability behind it" rule the run button already followed, so a caller
// that supplies neither renders the exact pre-R2-S read-only view.

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
  // Bot delete gates on its own bridge method, not bare scope: a caller
  // whose bridge predates R9-C renders the read-only header (same rule
  // the responsibility controls already follow).
  const canDeleteBot = Boolean(bridge?.botDelete && scope);
  const controller = useBotsPageController({
    snapshot,
    bridge,
    scope,
    onClose,
    onRunResponsibility,
  });
  const {
    effective,
    loading,
    loadError,
    showCreateForm,
    setShowCreateForm,
    createForm,
    setCreateForm,
    createBusy,
    createError,
    setSelectedBotId,
    selectedBot,
    showResponsibilityForm,
    setShowResponsibilityForm,
    responsibilityForm,
    setResponsibilityForm,
    responsibilityBusy,
    actionError,
    refresh,
    submitCreate,
    submitResponsibility,
    deleteResponsibility,
    deleteBot,
    runResponsibility,
    closeDetail,
  } = controller;

  const botRows = projectBotRows(effective.bots);

  return (
    // Fork root (BotsPage.tsx): `<main>`, no outer region — the page host
    // renders this directly, so any wrapper here would double the landmark.
    <main
      data-testid="bots-panel"
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
            size="icon-sm"
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
      <div className="flex-1 overflow-y-auto scrollbar-sleek">
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
                onDeleteBot={
                  canDeleteBot ? () => void deleteBot(selectedBot.id) : undefined
                }
                onOpenSession={
                  canMutate ? () => setSelectedBotId(selectedBot.id) : undefined
                }
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
                    ? (responsibilityId) => {
                        void runResponsibility(
                          selectedBot.id,
                          responsibilityId,
                        );
                      }
                    : undefined
                }
              />
              {canMutate && scope && bridge && (
                <BotConversation
                  botId={selectedBot.id}
                  harnessId={selectedBot.harnessPolicy.defaultHarness}
                  explicitModel={selectedBot.harnessPolicy.explicitModel}
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
          ) : loading ? (
            <BotLoadingState />
          ) : loadError && botRows.length === 0 ? (
            <BotsErrorState error={loadError} onRetry={() => void refresh()} />
          ) : botRows.length === 0 ? (
            <BotsEmptyState
              onCreate={
                canMutate ? () => setShowCreateForm(true) : undefined
              }
            />
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
                      onDeleteBot={
                        canDeleteBot ? () => void deleteBot(row.id) : undefined
                      }
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
                          ? (responsibilityId) => {
                              void runResponsibility(
                                row.id,
                                responsibilityId,
                              );
                            }
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
    </main>
  );
}

export default BotsPanel;
