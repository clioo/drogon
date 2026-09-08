// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationsPageSurface.tsx.
// Adaptation: local automations over this repo's `automation.*` bridge.
// The surface owns list state (search/filter/selection), the editor draft,
// delete target, detail history, the runs dashboard (pageView 'runs') and
// the run details page (pageView 'run') with the source's breadcrumb
// navigation; external scopes, hosts, SSH and Hermes branches are out of
// MVP scope. Layout and component order mirror the reference.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type {
  AutomationBridge,
  AutomationRunDetail,
  AutomationRunView,
  AutomationSummary,
} from "../../../../shared/automation-contract";
import type {
  Harness,
  Result,
  Status,
  Workspace,
} from "../../../../shared/session-contract";
import { AutomationsPageTopBar } from "./AutomationsPageTopBar";
import { AutomationsDetailPane } from "./AutomationsDetailPane";
import { AutomationsListPanel } from "./AutomationsListPanel";
import { AutomationEditorDialog } from "./AutomationEditorDialog";
import {
  AutomationDeleteDialog,
  setConfirmAutomationDelete,
  shouldConfirmAutomationDelete,
} from "./AutomationDeleteDialogs";
import { persistSkipDeleteAutomationConfirm } from "./automation-delete-confirm-preference";
import { AutomationRunsDashboardSurface } from "./AutomationRunsDashboardSurface";
import { AutomationRunDetailsPage } from "./AutomationRunDetailsPage";
import type { AutomationTemplate } from "./AutomationListEmptyView";
import {
  blankAutomationDraft,
  draftCron,
  parseGraceMinutes,
  validateAutomationDraft,
  type AutomationEditorDraft,
} from "./automation-editor-validation";
import type { AutomationPaneTab } from "./automation-detail-tab-navigation";
import { useAutomationsPageEscape } from "./automations-page-escape";
import {
  canRerunAutomationRun,
  getAutomationRunViewState,
  waitForAutomationRerunPendingVisibility,
} from "./automation-run-view-state";
import { getAutomationRunWorkspaceDisplay } from "./automation-run-workspace-display";
import { useAutomationRunsDashboard } from "./use-automation-runs-dashboard";
import {
  buildAutomationRunsDashboardEntries,
  type AutomationRunsDashboardEntry,
} from "./automation-runs-dashboard-model";
import {
  EMPTY_AUTOMATION_LIST_FILTER,
  isAutomationListSearchQueryTooLarge,
  projectAutomationList,
  type AutomationListFilter,
} from "./automation-list-projection";

export type AutomationsPageSurfaceProps = {
  bridge: AutomationBridge;
  workspace: Workspace;
  status: Status;
  listWorkspaces: () => Promise<Result<{ workspaces: Workspace[] }>>;
  listHarnesses?: () => Promise<Result<{ hostId: string; harnesses: Harness[] }>>;
  /** Top-level Escape closes the page (fork closeAutomationsPage). */
  onClose?: () => void;
};

type AutomationsPageView = "automations" | "runs" | "run";
type RunPageOrigin = "runs" | "automation";

function draftFromAutomation(
  automation: AutomationSummary,
  fallbackWorkspaceId: string,
): AutomationEditorDraft {
  // Cron → preset is lossy; seed the custom field so the exact expression
  // survives the edit round-trip.
  return {
    name: automation.name,
    prompt: automation.prompt,
    harness: automation.harness,
    workspaceId: automation.workspaceId ?? fallbackWorkspaceId,
    preset: "custom",
    time: "09:00",
    dayOfWeek: "1",
    customSchedule: automation.cron,
    enabled: automation.enabled,
    graceMinutes: "15",
    scheduleWarning: null,
  };
}

function draftFromTemplate(
  template: AutomationTemplate,
  workspaceId: string,
): AutomationEditorDraft {
  return {
    ...blankAutomationDraft(workspaceId),
    name: template.name,
    prompt: template.prompt,
    preset: template.preset,
    time: template.time,
  };
}

export function AutomationsPageSurface({
  bridge,
  workspace,
  status,
  listWorkspaces,
  onClose,
}: AutomationsPageSurfaceProps): React.JSX.Element {
  void status;
  const [automations, setAutomations] = useState<AutomationSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([workspace]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<AutomationListFilter>(EMPTY_AUTOMATION_LIST_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [activePaneTab, setActivePaneTab] = useState<AutomationPaneTab>("overview");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AutomationEditorDraft>(() => blankAutomationDraft(workspace.id));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationSummary | null>(null);
  const [runs, setRuns] = useState<AutomationRunView[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [relativeNow, setRelativeNow] = useState(() => Date.now());
  // Runs dashboard + run details page state (source pageView model).
  const [pageView, setPageView] = useState<AutomationsPageView>("automations");
  const [runPageOrigin, setRunPageOrigin] = useState<RunPageOrigin>("runs");
  const [runDetail, setRunDetail] = useState<AutomationRunDetail | null>(null);
  const [runDetailLoading, setRunDetailLoading] = useState(false);
  const [runDetailError, setRunDetailError] = useState<string | null>(null);
  const [runRerunPending, setRunRerunPending] = useState(false);
  const [runHistoryReloadToken, setRunHistoryReloadToken] = useState(0);
  const runsDashboard = useAutomationRunsDashboard({
    enabled: pageView === "runs",
    bridge,
    reloadToken: runHistoryReloadToken,
  });
  const runsEntries: readonly AutomationRunsDashboardEntry[] = useMemo(
    () => buildAutomationRunsDashboardEntries(runsDashboard.items),
    [runsDashboard.items],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setRelativeNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(
    async (initial = false) => {
      if (initial) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      try {
        const [listed, workspaceResult] = await Promise.all([
          bridge.list(),
          listWorkspaces(),
        ]);
        if (!listed.ok) throw new Error(listed.error.message);
        setAutomations(listed.result.automations);
        if (workspaceResult.ok && workspaceResult.result.workspaces.length > 0) {
          setWorkspaces(workspaceResult.result.workspaces);
        }
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Could not load automations.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [bridge, listWorkspaces],
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  const workspaceNameFor = useCallback(
    (workspaceId: string | null): string => {
      if (workspaceId === null) return "Missing workspace";
      return (
        workspaces.find((entry) => entry.id === workspaceId)?.name ?? "Missing workspace"
      );
    },
    [workspaces],
  );

  const projection = useMemo(
    () => projectAutomationList(automations, workspaceNameFor, searchQuery, filter),
    [automations, workspaceNameFor, searchQuery, filter],
  );

  const selected = useMemo(
    () => automations.find((automation) => automation.id === selectedId) ?? null,
    [automations, selectedId],
  );

  const loadRuns = useCallback(
    async (automationId: string) => {
      setRuns([]);
      setRunsError(null);
      setRunsLoading(true);
      try {
        const result = await bridge.history({ automationId, limit: 100 });
        if (!result.ok) throw new Error(result.error.message);
        setRuns(result.result.runs);
      } catch (failure) {
        setRunsError(
          failure instanceof Error ? failure.message : "Could not load run history.",
        );
      } finally {
        setRunsLoading(false);
      }
    },
    [bridge],
  );

  const openDetail = useCallback(
    (id: string) => {
      setSelectedId(id);
      setIsDetailOpen(true);
      setActivePaneTab("overview");
      setPageView("automations");
      void loadRuns(id);
    },
    [loadRuns],
  );

  const backToList = useCallback(() => {
    setIsDetailOpen(false);
    setActivePaneTab("overview");
    setPageView("automations");
  }, []);

  // --- Runs dashboard and run details page navigation (source model) -----

  const showAutomationsList = useCallback(() => {
    setPageView("automations");
    setRunDetail(null);
    setRunDetailError(null);
    setIsDetailOpen(false);
    setActivePaneTab("overview");
  }, []);

  const showRunsDashboard = useCallback(() => {
    setPageView("runs");
    setRunDetail(null);
    setRunDetailError(null);
    setIsDetailOpen(false);
    setActivePaneTab("overview");
  }, []);

  const showAutomationDetails = useCallback(() => {
    setPageView("automations");
    setRunDetail(null);
    setRunDetailError(null);
    setIsDetailOpen(true);
    setActivePaneTab("runs");
  }, []);

  const openRunPage = useCallback(
    (runId: string, automationId: string, origin: RunPageOrigin) => {
      setRunPageOrigin(origin);
      setPageView("run");
      setSelectedId(automationId);
      setIsDetailOpen(true);
      setRunDetailLoading(true);
      setRunDetailError(null);
      void bridge
        .run({ runId })
        .then((result) => {
          if (!result.ok) throw new Error(result.error.message);
          setRunDetail(result.result);
        })
        .catch((failure: unknown) => {
          setRunDetail(null);
          setRunDetailError(
            failure instanceof Error ? failure.message : "Could not load the run.",
          );
        })
        .finally(() => setRunDetailLoading(false));
    },
    [bridge],
  );

  const refreshRunDetail = useCallback(
    (runId: string) => {
      void bridge.run({ runId }).then((result) => {
        if (result.ok) setRunDetail(result.result);
      });
    },
    [bridge],
  );

  const rerunRunPage = useCallback(() => {
    if (!selected || !runDetail) return;
    const automationId = selected.id;
    setRunRerunPending(true);
    void bridge
      .runNow({ id: automationId })
      .catch(() => undefined)
      .then(() => waitForAutomationRerunPendingVisibility(Date.now()))
      .then(() => {
        setRunRerunPending(false);
        void refresh();
        refreshRunDetail(runDetail.id);
      });
  }, [bridge, refresh, refreshRunDetail, runDetail, selected]);

  // Escape precedence (source use-automations-page-escape, now including
  // the page-level close): run → back per origin; detail → list;
  // runs → automations; top level → close the page.
  const clearRunDetail = useCallback(() => {
    setRunDetail(null);
    setRunDetailError(null);
  }, []);
  useAutomationsPageEscape({
    editorOpen,
    deleteTarget: deleteTarget !== null,
    isDetailOpen,
    pageView,
    runPageOrigin,
    setPageView,
    setActivePaneTab,
    setIsDetailOpen,
    clearRunDetail,
    onClose,
  });

  const openCreate = useCallback(
    (template?: AutomationTemplate) => {
      setDraft(
        template
          ? draftFromTemplate(template, workspace.id)
          : blankAutomationDraft(workspace.id),
      );
      setEditingId(null);
      setSaveError(null);
      setEditorOpen(true);
    },
    [workspace.id],
  );

  const openEdit = useCallback(
    (id: string) => {
      const automation = automations.find((entry) => entry.id === id);
      if (!automation) return;
      setDraft(draftFromAutomation(automation, workspace.id));
      setEditingId(id);
      setSaveError(null);
      setEditorOpen(true);
    },
    [automations, workspace.id],
  );

  const applyTemplate = useCallback(
    (template: AutomationTemplate) => {
      setDraft((current) =>
        current.name.trim() === "" && current.prompt.trim() === ""
          ? draftFromTemplate(template, current.workspaceId)
          : {
              ...current,
              preset: template.preset,
              time: template.time,
            },
      );
    },
    [],
  );

  const save = useCallback(async () => {
    const errors = validateAutomationDraft(draft);
    if (Object.keys(errors).length > 0) {
      setSaveError("Check the highlighted fields.");
      return;
    }
    const wasEditing = editingId !== null;
    setSaving(true);
    setSaveError(null);
    try {
      const cron = draftCron(draft);
      const grace = parseGraceMinutes(draft.graceMinutes);
      if (editingId === null) {
        const created = await bridge.create({
          name: draft.name.trim(),
          cron,
          workspaceId: draft.workspaceId,
          harness: draft.harness as "claude" | "pi" | "opencode" | "antigravity" | "codex",
          prompt: draft.prompt,
          enabled: draft.enabled,
          ...(grace === undefined ? {} : { graceMinutes: grace }),
        });
        if (!created.ok) throw new Error(created.error.message);
        setSelectedId(created.result.id);
      } else {
        const updated = await bridge.update({
          id: editingId,
          name: draft.name.trim(),
          cron,
          workspaceId: draft.workspaceId,
          harness: draft.harness as "claude" | "pi" | "opencode" | "antigravity" | "codex",
          prompt: draft.prompt,
          enabled: draft.enabled,
          ...(grace === undefined ? {} : { graceMinutes: grace }),
        });
        if (!updated.ok) throw new Error(updated.error.message);
      }
      setEditorOpen(false);
      await refresh();
      if (editingId !== null) await loadRuns(editingId);
      toast.success(wasEditing ? "Automation updated." : "Automation saved.");
    } catch (failure) {
      setSaveError(
        failure instanceof Error ? failure.message : "Could not save the automation.",
      );
      toast.error(
        failure instanceof Error ? failure.message : "Failed to save automation.",
      );
    } finally {
      setSaving(false);
    }
  }, [bridge, draft, editingId, loadRuns, refresh]);

  const requestDelete = useCallback((id: string) => {
    const automation = automations.find((entry) => entry.id === id);
    if (!automation) return;
    if (!shouldConfirmAutomationDelete()) {
      void bridge.remove({ id }).then(() => {
        if (selectedId === id) {
          setSelectedId(null);
          setIsDetailOpen(false);
        }
        void refresh();
      });
      return;
    }
    setDeleteTarget(automation);
  }, [automations, bridge, refresh, selectedId]);

  const confirmDelete = useCallback(
    async (dontAskAgain: boolean) => {
      if (!deleteTarget) return;
      if (dontAskAgain)
        persistSkipDeleteAutomationConfirm({
          persist: () => setConfirmAutomationDelete(false),
        });
      else setConfirmAutomationDelete(true);
      const id = deleteTarget.id;
      setDeleteTarget(null);
      const result = await bridge.remove({ id });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (selectedId === id) {
        setSelectedId(null);
        setIsDetailOpen(false);
      }
      await refresh();
    },
    [bridge, deleteTarget, refresh, selectedId],
  );

  const runNow = useCallback(
    async (id: string) => {
      setRunningId(id);
      try {
        const result = await bridge.runNow({ id });
        if (!result.ok) throw new Error(result.error.message);
        await refresh();
        if (selectedId === id) await loadRuns(id);
        toast.message("Automation run queued.");
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : "Could not run the automation.",
        );
        toast.error(
          failure instanceof Error ? failure.message : "Failed to run automation.",
        );
      } finally {
        setRunningId(null);
      }
    },
    [bridge, loadRuns, refresh, selectedId],
  );

  const toggleEnabled = useCallback(
    async (id: string) => {
      const automation = automations.find((entry) => entry.id === id);
      if (!automation) return;
      const result = await bridge.update({ id, enabled: !automation.enabled });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      await refresh();
    },
    [automations, bridge, refresh],
  );

  const draftErrors = useMemo(() => validateAutomationDraft(draft), [draft]);
  const selectedWorkspaceName = selected ? workspaceNameFor(selected.workspaceId) : "";

  // Run page derived state (source use-automation-run-page-state, adapted:
  // session existence comes from the daemon's `automation.run`).
  const runPageWorkspace = useMemo(
    () =>
      runDetail?.workspaceId
        ? (workspaces.find((entry) => entry.id === runDetail.workspaceId) ?? null)
        : null,
    [runDetail?.workspaceId, workspaces],
  );
  const runPageWorkspaceDisplay = useMemo(
    () =>
      runDetail
        ? getAutomationRunWorkspaceDisplay({
            run: runDetail,
            workspace: runPageWorkspace,
          })
        : null,
    [runDetail, runPageWorkspace],
  );
  const runPageViewState = useMemo(
    () =>
      runDetail
        ? getAutomationRunViewState({
            run: runDetail,
            sessionExists: runDetail.sessionExists,
          })
        : null,
    [runDetail],
  );
  const canRerunRunPage = useMemo(
    () =>
      runDetail !== null &&
      canRerunAutomationRun({ automationId: selected?.id ?? null, run: runDetail }),
    [runDetail, selected?.id],
  );

  return (
    <main
      className="relative flex h-full min-h-0 flex-col bg-background pt-5 text-foreground md:pt-6"
      data-testid="automations-panel"
    >
      <AutomationsPageTopBar
        pageView={pageView}
        isDetailOpen={isDetailOpen}
        selectedAutomationName={selected?.name}
        runPageOrigin={runPageOrigin}
        showAutomationsList={showAutomationsList}
        showRunsDashboard={showRunsDashboard}
        showAutomationDetails={showAutomationDetails}
      />
      {error !== null ? (
        <p role="alert" className="shrink-0 px-3 pb-2 text-sm text-destructive md:px-5">
          {error}
        </p>
      ) : null}
      {pageView === "runs" ? (
        <AutomationRunsDashboardSurface
          entries={runsEntries}
          loading={runsDashboard.loading}
          hasMore={runsDashboard.hasMore}
          onLoadMore={runsDashboard.loadMore}
          now={relativeNow}
          error={runsDashboard.error}
          onRefresh={() => setRunHistoryReloadToken((token) => token + 1)}
          onOpenRun={(entry) =>
            openRunPage(entry.run.id, entry.run.automationId, "runs")
          }
        />
      ) : pageView === "run" && runDetail ? (
        <AutomationRunDetailsPage
          automation={selected}
          run={runDetail}
          relativeNow={relativeNow}
          workspaceDisplay={runPageWorkspaceDisplay}
          viewState={runPageViewState}
          canRerun={canRerunRunPage}
          isRerunPending={runRerunPending}
          onRerun={rerunRunPage}
          onOpenWorkspace={() => refreshRunDetail(runDetail.id)}
          onBack={runPageOrigin === "automation" ? showAutomationDetails : showRunsDashboard}
        />
      ) : pageView === "run" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-5">
          {runDetailError !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {runDetailError}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {runDetailLoading ? "Loading run…" : "Run not available."}
            </p>
          )}
        </div>
      ) : isDetailOpen && selected ? (
        <AutomationsDetailPane
          selected={selected}
          workspaceName={selectedWorkspaceName}
          runs={runs}
          runsLoading={runsLoading}
          runsError={runsError}
          activePaneTab={activePaneTab}
          relativeNow={relativeNow}
          running={runningId === selected.id}
          onActivePaneTabChange={setActivePaneTab}
          onRunNow={(automation) => void runNow(automation.id)}
          onEdit={(automation) => openEdit(automation.id)}
          onToggle={(automation) => void toggleEnabled(automation.id)}
          onDelete={(automation) => requestDelete(automation.id)}
          onBackToList={backToList}
          onOpenRun={(run) => openRunPage(run.id, run.automationId, "automation")}
        />
      ) : (
        <AutomationsListPanel
          loading={loading}
          error={error}
          totalCount={projection.totalCount}
          rows={projection.rows}
          searchActive={projection.searchActive}
          listSearchQuery={searchQuery}
          isListSearchQueryTooLarge={isAutomationListSearchQueryTooLarge(searchQuery)}
          onListSearchQueryChange={setSearchQuery}
          listFilter={filter}
          onListFilterChange={setFilter}
          selectedId={selectedId}
          relativeNow={relativeNow}
          runningId={runningId}
          isRefreshing={refreshing}
          onOpenRuns={showRunsDashboard}
          onSelect={openDetail}
          onRunNow={(id) => void runNow(id)}
          onEdit={openEdit}
          onToggle={(id) => void toggleEnabled(id)}
          onDelete={requestDelete}
          onRefresh={() => void refresh()}
          openCreateDialog={openCreate}
        />
      )}
      <AutomationEditorDialog
        open={editorOpen}
        isEditing={editingId !== null}
        isSaving={saving}
        draft={draft}
        workspaces={workspaces}
        errors={saveError !== null ? draftErrors : {}}
        onDraftChange={(updater) => {
          setDraft(updater);
          setSaveError(null);
        }}
        onApplyTemplate={applyTemplate}
        onOpenChange={setEditorOpen}
        onSave={() => void save()}
      />
      {saveError !== null ? (
        <p role="alert" className="sr-only">
          {saveError}
        </p>
      ) : null}
      <AutomationDeleteDialog
        deleteTarget={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={(dontAskAgain) => void confirmDelete(dontAskAgain)}
      />
    </main>
  );
}
