/* MIT Copyright (c) 2026 Lovecast Inc. Rebuilt to the OWNER'S DESIGN
 * (task_197f6a7eb370 — "los bots no se ven como el diseño que te había
 * pasado… tiene que parecerse"): header row with back arrow, title, an
 * active-count chip and a refresh icon button; on the right a
 * "Filter bots…" search input with a filter icon and the "+ New Bot"
 * button in the app's red accent; then the design's subtitle line, the
 * create form, and the list of design cards (BotResponsibilityCard).
 * Adaptation is data-layer only: the snapshot and the gated bot bridge are
 * injected by the caller (no zustand store, no window.api) and the
 * keep-alive host owns the single App mount point. `data-testid` hooks
 * stay: the packaged probe and contract tests address the panel through
 * them (bots-panel, bots-empty, bots-filter-input, bots-active-count). */
import { ArrowLeft, Filter, Plus, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { BotCreationForm } from "./BotCreationForm";
import { BotResponsibilityCard } from "./BotResponsibilityCard";
import { ResponsibilityFormCard } from "./BotsPageForms";
import {
  BotLoadingState,
  BotsEmptyState,
  BotsErrorState,
} from "./BotsPageStates";
import { useBotsPageController } from "./use-bots-page-controller";
import {
  countActiveBots,
  filterBots,
  isBotUnconfigured,
} from "./bots-page-model";
import type { AutomationSummary } from "../../../../shared/automation-contract";
import type { BotMonitorView } from "../../../../shared/bot-contract";
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
  /** Host-supplied side reads for the redesigned columns; injectable so
   *  tests can pin the join without a window bridge. Defaults derive from
   *  `window.drogon` and the gated bridge. */
  automationList?: () => Promise<{
    ok: boolean;
    result?: { automations: AutomationSummary[] };
  }>;
  monitorList?: (input: {
    hostId: string;
    workspaceId: string;
    botId: string;
  }) => Promise<{
    ok: boolean;
    result?: { monitors: BotMonitorView[]; workspaceId: string };
  }>;
  /** Host-supplied monitor approval (the parked-watch affordance);
   *  injectable so tests can pin it. Defaults to the gated bridge's
   *  `botMonitorApprove` — the daemon's hash-bound approval path. */
  monitorApprove?: (input: {
    hostId: string;
    workspaceId: string;
    botId: string;
    monitorId: string;
  }) => Promise<{ ok: boolean; error?: { message: string } }>;
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
  observedLivenessByBotId,
  automationList: automationListProp,
  monitorList: monitorListProp,
  monitorApprove: monitorApproveProp,
}: BotsPanelHydrationProps) {
  const botMonitorList = bridge?.botMonitorList;
  const botMonitorApprove = bridge?.botMonitorApprove;
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
    // Host-supplied side reads for the redesigned columns (real
    // scheduler records + durable monitors). Guarded so every existing
    // test/caller without a window bridge keeps rendering the read-only
    // view: absent sources leave the columns honest, never invented.
    automationList:
      automationListProp ??
      (typeof window !== "undefined" && window.drogon?.automation
        ? () => window.drogon.automation.list()
        : undefined),
    monitorList:
      monitorListProp ??
      (botMonitorList ? (input) => botMonitorList(input) : undefined),
    monitorApprove:
      monitorApproveProp ??
      (botMonitorApprove ? (input) => botMonitorApprove(input) : undefined),
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
    approveMonitor,
    automationSummaries,
    monitorsByBotId,
    expandedOverrides,
    toggleExpanded,
    filterQuery,
    setFilterQuery,
  } = controller;

  const visibleBots = filterBots(effective.bots, filterQuery);
  const activeCount = countActiveBots(
    effective.bots,
    monitorsByBotId ?? {},
    observedLivenessByBotId,
  );
  const automationsById: Map<string, AutomationSummary> | null =
    automationSummaries === null
      ? null
      : new Map(automationSummaries.map((item) => [item.id, item]));

  return (
    // Fork root (BotsPage.tsx): `<main>`, no outer region — the page host
    // renders this directly, so any wrapper here would double the landmark.
    <main
      data-testid="bots-panel"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <header className="shrink-0 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          {/* Fork parity (#348): the Back control renders unconditionally —
              the fork's BotsPage always shows it; without an onClose it is
              a no-op, never hidden. The design renders it as an icon
              button. */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Back"
            className="shrink-0"
          >
            <ArrowLeft />
          </Button>
          <h1 className="shrink-0 text-base font-bold">Bots</h1>
          <span
            data-testid="bots-active-count"
            className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
          >
            {activeCount} active
          </span>
          <span className="min-w-0 flex-1" />
          <label className="relative min-w-0 shrink">
            <Filter
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              placeholder="Filter bots…"
              aria-label="Filter bots"
              data-testid="bots-filter-input"
              className="h-8 w-full min-w-0 pl-8 sm:w-56"
            />
          </label>
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
            variant="destructive"
            size="sm"
            className="shrink-0"
            disabled={showCreateForm || busy}
            onClick={() => setShowCreateForm(true)}
          >
            <Plus />
            New Bot
          </Button>
        </div>
      </header>
      <p className="shrink-0 px-5 pt-3 text-xs text-muted-foreground">
        Your team of agents, with memory and a purpose. Configured with
        dedicated daemon scopes, scheduled triggers, and invariant monitors.
      </p>
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
            visibleBots.length ? (
              <div className="space-y-4" role="list" aria-label="Bots">
                {visibleBots.map((bot) => {
                  const monitorCount =
                    monitorsByBotId?.[bot.id]?.length ?? 0;
                  const unconfigured = isBotUnconfigured(bot, monitorCount);
                  return (
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
                        automationsById={automationsById}
                        monitors={monitorsByBotId?.[bot.id] ?? null}
                        busy={busy}
                        observedLiveness={observedLivenessByBotId?.[bot.id]}
                        expanded={expandedOverrides[bot.id] ?? !unconfigured}
                        onToggleExpanded={() => toggleExpanded(bot.id)}
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
                        onApproveMonitor={(monitorId) =>
                          void approveMonitor(bot.id, monitorId)
                        }
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p
                data-testid="bots-filter-empty"
                className="rounded-lg border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground"
                role="status"
              >
                No bots match “{filterQuery.trim()}”.
              </p>
            )
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
