/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/BotsPage.tsx (page composition: header
   with Back/title/refresh/New Bot, action-error alert, create form, then
   loading / error / list / empty states, with the responsibility form under
   the selected bot — R17-E #348: the fork's exact state chain, selection
   ring and unconditional header controls are restored; this repo's earlier
   detail-view/conversation detour is removed as invented UI). Adaptation is
   data-layer only: the snapshot and the gated bot bridge are injected by the
   caller (no zustand store, no window.api) and the keep-alive host owns the
   single App mount point. `data-testid` hooks stay: the packaged probe and
   contract tests address the panel through them. */
import { ArrowLeft, Plus, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { BotCreationForm } from "./BotCreationForm";
import { BotResponsibilityCard } from "./BotResponsibilityCard";
import { ResponsibilityFormCard } from "./BotsPageForms";
import {
  BotLoadingState,
  BotsEmptyState,
  BotsErrorState,
} from "./BotsPageStates";
import { useBotsPageController } from "./use-bots-page-controller";
import type { BotsPanelProps } from "./bots-panel-contracts";

export type BotsPanelHydrationProps = BotsPanelProps & {
  /** Set by the mount while the first snapshot for the live scope is still
   *  in flight: the controller paints the fork's loading state over the
   *  placeholder snapshot instead of flashing the empty state. Cleared on
   *  hydration; never part of the shared contract. */
  snapshotPending?: boolean;
  /** Placement folder for bot.create (#348/R17-E follow-up): reads ride the
   *  app-global scope, but a new bot must land in a real workspace folder
   *  (native has no owning bot to resolve it from). Supplied by the host
   *  from the selected workspace; absent means create is refused with an
   *  honest error instead of a native "workspace not found". */
  createWorkspaceId?: string;
};

export function BotsPanel({
  snapshot,
  onClose,
  onRunResponsibility,
  bridge,
  scope,
  snapshotPending,
  createWorkspaceId,
  onOpenSession,
  resolveBotSession,
}: BotsPanelHydrationProps) {
  const controller = useBotsPageController({
    snapshot,
    bridge,
    scope,
    onClose,
    onRunResponsibility,
    snapshotPending,
    createWorkspaceId,
    onOpenSession,
    resolveBotSession,
  });
  const {
    effective,
    loading,
    loadError,
    showCreateForm,
    setShowCreateForm,
    createForm,
    setCreateForm,
    busy,
    actionError,
    setSelectedBotId,
    selectedBot,
    showResponsibilityForm,
    setShowResponsibilityForm,
    responsibilityForm,
    setResponsibilityForm,
    refresh,
    submitCreate,
    submitResponsibility,
    deleteBot,
    runResponsibility,
    launchBot,
  } = controller;

  return (
    // Fork root (BotsPage.tsx): `<main>`, no outer region — the page host
    // renders this directly, so any wrapper here would double the landmark.
    <main
      data-testid="bots-panel"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        {/* Fork parity (#348): the Back control renders unconditionally —
            the fork's BotsPage always shows it; without an onClose it is a
            no-op, never hidden. */}
        <Button
          variant="outline"
          size="sm"
          onClick={onClose}
          className="shrink-0 gap-1.5"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">Bots</h1>
          <p className="truncate text-xs text-muted-foreground">
            Your team of agents, with memory and a purpose.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void refresh()}
          aria-label="Refresh Bots"
          disabled={loading}
        >
          <RefreshCw
            className={loading ? "animate-spin motion-reduce:animate-none" : ""}
          />
        </Button>
        <Button
          size="sm"
          disabled={showCreateForm || busy}
          onClick={() => setShowCreateForm(true)}
        >
          <Plus />
          New Bot
        </Button>
      </header>
      <div className="flex-1 overflow-y-auto scrollbar-sleek">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-5 sm:p-7">
          {actionError ? (
            <div
              className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {actionError}
            </div>
          ) : null}
          {showCreateForm ? (
            <BotCreationForm
              form={createForm}
              busy={busy}
              onChange={(updates) =>
                setCreateForm((current) => ({ ...current, ...updates }))
              }
              onCancel={() => setShowCreateForm(false)}
              onSubmit={() => void submitCreate()}
            />
          ) : loading ? (
            <BotLoadingState />
          ) : loadError ? (
            <BotsErrorState error={loadError} onRetry={() => void refresh()} />
          ) : effective.bots.length ? (
            <div className="space-y-4" role="list" aria-label="Bots">
              {effective.bots.map((bot) => (
                <div
                  key={bot.id}
                  role="listitem"
                  className={
                    selectedBot?.id === bot.id
                      ? "rounded-xl ring-1 ring-ring/40"
                      : ""
                  }
                  onClick={() => setSelectedBotId(bot.id)}
                >
                  <BotResponsibilityCard
                    bot={bot}
                    history={effective.history}
                    onAddResponsibility={() => {
                      setSelectedBotId(bot.id);
                      setShowResponsibilityForm(true);
                    }}
                    onDelete={() => void deleteBot(bot.id)}
                    onRunResponsibility={(responsibilityId) => {
                      setSelectedBotId(bot.id);
                      void runResponsibility(bot.id, responsibilityId);
                    }}
                    onLaunch={() => void launchBot(bot)}
                    onLaunchNew={() =>
                      void launchBot(bot, { forceNew: true })
                    }
                  />
                </div>
              ))}
            </div>
          ) : (
            <BotsEmptyState onCreate={() => setShowCreateForm(true)} />
          )}
          {selectedBot && showResponsibilityForm ? (
            <ResponsibilityFormCard
              form={responsibilityForm}
              busy={busy}
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
      </div>
    </main>
  );
}

export default BotsPanel;
