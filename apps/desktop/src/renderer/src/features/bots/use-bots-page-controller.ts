/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/use-bots-page-controller.ts.
   R17-E #348: the fork's exact controller semantics are restored — one
   shared busy/error channel for every action, first-bot auto-selection,
   selection falling back to the first bot, and the fork's Escape chain
   (create form → responsibility form → close the page). `launchBot`
   dispatches a `bot.run` chat turn with the bot's stored harness overrides
   (this repo's headless session primitive — the fork's
   launch-drogon-bot-session tab path is not ported); reads are app-global
   (#348/R17-E) and native resolves the bot's owning workspace, so only a
   missing scope refuses, while create carries the host's placement folder.
   Data-layer
   adaptations (no zustand store, no window.api): the snapshot, bridge and
   scope are injected by the caller; the reload-after-every-mutation and
   busy-gate rules are the source's; the keep-alive host visibility gate on
   Escape is this repo's (#270 — the fork unmounts the page instead). */

import { useCallback, useEffect, useState } from "react";
import type { AutomationSummary } from "../../../../shared/automation-contract";
import type {
  BotBridge,
  BotLiveSession,
  BotMonitorView,
  BotRunHarnessSource,
  BotScope,
  BotsPanelBot,
  BotsPanelSnapshot,
  BotSessionResolution,
} from "./bots-panel-contracts";
import {
  buildBotCreateBody,
  emptyBotCreateForm,
  emptyResponsibilityForm,
  harnessSupportsConversationResume,
  isBotUnconfigured,
} from "./bots-page-model";
import type {
  BotCreateFormValues,
  ResponsibilityFormValues,
} from "./bots-page-model";
import { dispatchOpenBotSession } from "./bot-session-open";

/** The App keep-alive host for the Bots page. Single source of truth
 *  shared by the host element and the Escape visibility check (same
 *  adaptation as features/tasks/task-page-global-escape.ts). */
export const BOTS_PAGE_HOST_TESTID = "bots-page-host";
export const BOTS_PAGE_HOST_SELECTOR = `[data-testid="${BOTS_PAGE_HOST_TESTID}"]`;

export type BotsPageControllerDeps = {
  snapshot: BotsPanelSnapshot;
  bridge?: BotBridge;
  scope?: (BotScope & { locale: string }) | null;
  onClose?: () => void;
  onRunResponsibility?: (input: {
    botId: string;
    responsibilityId: string;
    harness?: BotRunHarnessSource;
  }) => void | Promise<void>;
  /** True while the mount's first snapshot for the live scope is still in
   *  flight over a placeholder snapshot: start (and stay) in the fork's
   *  loading state instead of flashing the empty state. */
  snapshotPending?: boolean;
  /** Placement folder for bot.create (BotsPanel's `createWorkspaceId`):
   *  reads ride the app-global scope, but a new bot must land in a real
   *  workspace folder. Absent/empty means create is refused honestly. */
  createWorkspaceId?: string;
  /** Host-owned in-app presentation for an opened session (BotsPanel's
   *  `onOpenSession`, shared contract): called with the real dispatched
   *  session so the host can open/focus the canonical tab in-app. */
  onOpenSession?: (input: {
    botId: string;
    sessionId: string;
    incarnation: string;
    harness: BotRunHarnessSource;
    workspaceId: string;
    hostId: string;
    displayName: string;
    handle: string | null;
    title: string | null;
  }) => void | Promise<void>;
  /** Host-owned liveness lookup for the default Open-session click
   *  (Defect 1): what the daemon knows about the Bot's recorded session --
   *  focus it, reopen it with a resume, open fresh (no record), or refuse
   *  because liveness is not established. See
   *  `BotsPanelProps.resolveBotSession`. */
  resolveBotSession?: (input: { bot: BotsPanelBot }) => BotSessionResolution;
  /** Host-owned liveness lookup for the default Open-session click (Gap 2):
   *  the recorded session ONLY when the daemon-owned verdict says it is not
   *  exited, else null. See `BotsPanelProps.resolveBotSession`. */
  resolveBotSession?: (input: { bot: BotsPanelBot }) => BotLiveSession | null;
  /** Host-supplied automation summary list (the redesigned AUTOMATIONS
   *  column joins scheduled responsibilities with their real scheduler
   *  record: cron, timezone, harness/model, next/last run). Optional so
   *  callers without the automation namespace keep compiling; absent means
   *  the column renders only what the bot record itself carries. */
  automationList?: () => Promise<{
    ok: boolean;
    result?: { automations: AutomationSummary[] };
  }>;
  /** Host-supplied monitor read (the redesigned MONITORS column). Optional;
   *  absent/unavailable means the column says so honestly instead of
   *  rendering rows it cannot see. */
  monitorList?: (input: {
    hostId: string;
    workspaceId: string;
    botId: string;
  }) => Promise<{
    ok: boolean;
    result?: { monitors: BotMonitorView[]; workspaceId: string };
  }>;
};

function mintRequestId(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useBotsPageController(deps: BotsPageControllerDeps) {
  const {
    snapshot,
    bridge,
    scope,
    onClose,
    onRunResponsibility,
    onOpenSession,
    createWorkspaceId,
    resolveBotSession,
    automationList,
    monitorList,
  } = deps;

  const [localSnapshot, setLocalSnapshot] =
    useState<BotsPanelSnapshot | null>(null);
  useEffect(() => {
    setLocalSnapshot(null);
  }, [snapshot]);
  const effective = localSnapshot ?? snapshot;

  // Fork parity (#237): the mount registers the page over a placeholder
  // snapshot and hydrates after, so the first paint must be the fork's
  // loading state — never a one-frame empty state before the rows land.
  const [loading, setLoading] = useState(Boolean(deps.snapshotPending));
  useEffect(() => {
    // Hydration (or scope change back to a settled snapshot) clears the
    // mount-driven loading state. Manual refresh() owns its own
    // loading window afterwards: pending is already false by then, so
    // this effect never fights it.
    if (!deps.snapshotPending) setLoading(false);
  }, [deps.snapshotPending]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] =
    useState<BotCreateFormValues>(emptyBotCreateForm());
  const [showResponsibilityForm, setShowResponsibilityForm] = useState(false);
  const [responsibilityForm, setResponsibilityForm] =
    useState<ResponsibilityFormValues>(emptyResponsibilityForm());
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Redesigned page data: the real automation scheduler records (joined by
  // automationId) and each bot's durable monitors. Both degrade honestly:
  // a null list means "no data source", never an empty claim.
  const [automationSummaries, setAutomationSummaries] = useState<
    AutomationSummary[] | null
  >(null);
  const [monitorsByBotId, setMonitorsByBotId] = useState<Record<
    string,
    BotMonitorView[]
  > | null>(null);
  // Per-bot card expansion. Unset means "the design's default": configured
  // bots render expanded, bots with nothing configured render as the
  // compact collapsed row. Explicit toggles win over the default.
  const [expandedOverrides, setExpandedOverrides] = useState<
    Record<string, boolean>
  >({});
  // Header "Filter bots…" query (client-side, real fields only).
  const [filterQuery, setFilterQuery] = useState("");

  // The fork's load(): one loader for mount, refresh and every post-mutation
  // reload; the fork auto-selects the first bot on a fresh snapshot (drives
  // the selection ring and the responsibility form). Without a bridge/scope
  // (capability-gated caller) there is nothing to load and the caller-
  // supplied snapshot stands; the fork always has window.api.
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      if (!bridge?.botSnapshot || !scope) {
        return;
      }
      const response = await bridge.botSnapshot(scope);
      if (response.ok) {
        const next: BotsPanelSnapshot = {
          bots: response.result.bots,
          history: response.result.history,
        };
        setLocalSnapshot(next);
        setSelectedBotId((current) => current ?? next.bots[0]?.id ?? null);
      } else {
        setLoadError(response.error.message);
      }
    } catch (loadError_) {
      setLoadError(errorMessage(loadError_));
    } finally {
      setLoading(false);
    }
  }, [bridge, scope]);

  // Side reads for the redesigned columns. They ride the SNAPSHOT, not the
  // bridge: a props-only read-only panel still joins real scheduler
  // records and durable monitors when the host supplies the sources. Each
  // degrades independently — a missing/failed source leaves that column's
  // data unset, never an invented empty. Refetching whenever the snapshot
  // identity changes also refreshes them after every post-mutation reload.
  useEffect(() => {
    if (!automationList) return;
    let cancelled = false;
    void (async () => {
      try {
        const listed = await automationList();
        if (!cancelled && listed.ok && listed.result) {
          setAutomationSummaries(listed.result.automations);
        }
      } catch {
        // Keep the previous summaries; the column stays honest.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [automationList, localSnapshot, snapshot]);

  useEffect(() => {
    if (!monitorList || !scope) return;
    const bots = (localSnapshot ?? snapshot).bots;
    if (bots.length === 0) return;
    let cancelled = false;
    void (async () => {
      const results = await Promise.allSettled(
        bots.map(async (bot) => {
          const listed = await monitorList({
            hostId: scope.hostId,
            workspaceId: scope.workspaceId,
            botId: bot.id,
          });
          return { botId: bot.id, listed } as const;
        }),
      );
      const nextMonitors: Record<string, BotMonitorView[]> = {};
      let sawSource = false;
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        sawSource = true;
        const { botId, listed } = result.value;
        if (listed.ok && listed.result) {
          nextMonitors[botId] = listed.result.monitors;
        }
      }
      if (!cancelled && sawSource) setMonitorsByBotId(nextMonitors);
    })();
    return () => {
      cancelled = true;
    };
  }, [monitorList, localSnapshot, snapshot, scope]);

  useEffect(() => {
    void load();
    // The fork intentionally reloads only on mount or an explicit refresh;
    // snapshot hydration is the caller's (keep-alive mount) concern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Keep-alive host hidden (another route is active): that page owns
      // Escape. The fork unmounts this page on view switches, so its
      // listener simply does not exist there; Drogon must gate it.
      const host = document.querySelector(BOTS_PAGE_HOST_SELECTOR);
      if (
        !host ||
        (typeof host.checkVisibility === "function" && !host.checkVisibility())
      ) {
        return;
      }
      if (
        event.key === "Escape" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        if (showCreateForm) {
          setShowCreateForm(false);
        } else if (showResponsibilityForm) {
          setShowResponsibilityForm(false);
        } else {
          onClose?.();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, showCreateForm, showResponsibilityForm]);

  const selectedBot =
    effective.bots.find((bot) => bot.id === selectedBotId) ??
    effective.bots[0] ??
    null;

  const submitCreate = useCallback(async (): Promise<void> => {
    if (busy) {
      return;
    }
    if (!bridge?.botCreate || !scope) {
      setActionError(
        "Install or refresh a supported harness before creating a Bot.",
      );
      return;
    }
    // Reads ride the app-global scope, but native files a new bot under an
    // exact workspace folder (it has no owning bot to resolve one from),
    // so create carries the host's placement folder instead of the global
    // sentinel — which native would honestly reject as unknown workspace.
    const placementWorkspaceId = createWorkspaceId ?? scope.workspaceId;
    if (!placementWorkspaceId) {
      setActionError("Select a workspace before creating a Bot.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const response = await bridge.botCreate({
        ...scope,
        workspaceId: placementWorkspaceId,
        requestId: mintRequestId("bot-create"),
        body: buildBotCreateBody(createForm),
      });
      if (!response.ok) {
        setActionError(response.error.message);
        return;
      }
      setSelectedBotId(response.result.id);
      setShowCreateForm(false);
      setCreateForm(emptyBotCreateForm());
      await load();
    } catch (createFailure) {
      setActionError(errorMessage(createFailure));
    } finally {
      setBusy(false);
    }
  }, [bridge, scope, busy, createForm, createWorkspaceId, load]);

  const submitResponsibility = useCallback(
    async (botId: string): Promise<void> => {
      if (busy) {
        return;
      }
      if (!bridge?.botResponsibilityCreate || !scope) {
        return;
      }
      setBusy(true);
      setActionError(null);
      try {
        const response = await bridge.botResponsibilityCreate({
          ...scope,
          requestId: mintRequestId("bot-responsibility"),
          botId,
          name: responsibilityForm.name.trim(),
          schedule: responsibilityForm.cron.trim(),
          prompt: responsibilityForm.prompt,
        });
        if (!response.ok) {
          setActionError(response.error.message);
          return;
        }
        setShowResponsibilityForm(false);
        setResponsibilityForm(emptyResponsibilityForm());
        await load();
      } catch (responsibilityFailure) {
        setActionError(errorMessage(responsibilityFailure));
      } finally {
        setBusy(false);
      }
    },
    [bridge, scope, busy, responsibilityForm, load],
  );

  const deleteBot = useCallback(
    async (botId: string): Promise<void> => {
      if (busy) {
        return;
      }
      if (!bridge?.botDelete || !scope) {
        return;
      }
      setBusy(true);
      setActionError(null);
      try {
        const response = await bridge.botDelete({
          ...scope,
          requestId: mintRequestId("bot-delete"),
          botId,
        });
        if (!response.ok) {
          setActionError(response.error.message);
          return;
        }
        await load();
      } catch (deleteFailure) {
        setActionError(errorMessage(deleteFailure));
      } finally {
        setBusy(false);
      }
    },
    [bridge, scope, busy, load],
  );

  // Manual run (R16-S): resolves the harness from the LIVE snapshot (never
  // the mount-time one, which predates in-panel mutations), awaits the
  // mount's `bot.run` call, then reloads so the new history row appears --
  // the fork's `await runResponsibility(); await load()`. Failures surface
  // in the action-error alert instead of vanishing into a void promise.
  const runResponsibility = useCallback(
    async (botId: string, responsibilityId: string): Promise<void> => {
      if (busy) {
        return;
      }
      if (!onRunResponsibility) return;
      const bot = (localSnapshot ?? snapshot).bots.find(
        (candidate) => candidate.id === botId,
      );
      if (!bot) {
        setActionError(
          "That bot is no longer in the snapshot; refresh and retry.",
        );
        return;
      }
      setBusy(true);
      setActionError(null);
      try {
        await onRunResponsibility({
          botId,
          responsibilityId,
          harness: {
            harnessId: bot.harnessPolicy.defaultHarness,
            explicitModel: bot.harnessPolicy.explicitModel,
          },
        });
        await load();
      } catch (runFailure) {
        setActionError(errorMessage(runFailure));
      } finally {
        setBusy(false);
      }
    },
    [busy, onRunResponsibility, localSnapshot, snapshot, load],
  );

  // Open session (bug-bot-a836b4ebf8be65505; Carlos directive on
  // task_e7c183ebc637; Gap 2 resume on task_926fddc5e769): the DEFAULT
  // click first asks the host whether the Bot's recorded session is still
  // live (`resolveBotSession`); if it is, it focuses that session and
  // dispatches nothing. Only when there is no resumable session does it
  // dispatch a `bot.run` OPEN-SESSION turn (`interactive: true`, NO prompt
  // — the wire contract rejects a prompt outright) with the bot's STORED
  // harness overrides (buildBotRunHarness — the same resolution the mount
  // uses for manual runs). Native starts the harness's own interactive
  // entrypoint in the Bot's provisioned home and delivers NOTHING to it:
  // no model turn is burned, the session opens live and IDLE, and the
  // owner's first real message is the first thing the harness ever sees.
  // Liveness and environment are daemon facts (the header's status pill and
  // the session inspector) — never a recital the model is asked to invent.
  // `forceNew` (the card's "New session" control) skips the resume check.
  // The dispatch still selects the bot and hands the returned session to
  // the host's `onOpenSession` (when supplied) so the app can open/focus
  // the canonical Bot-linked tab in-app, then reloads so the new session
  // state lands. Reads are app-global and native resolves the '' scope to
  // the bot's owning workspace, so no workspace-selection refusal
  // remains: only a missing scope (unknown host) refuses. Every other
  // failure — a bridge without botRun (capability withheld), a
  // daemon-unreachable transport throw, a refused/unsupported outcome —
  // lands in the shared action-error alert, never a silent no-op.
  const launchBot = useCallback(
    async (
      bot: { id: string },
      options?: { forceNew?: boolean },
    ): Promise<void> => {
      if (busy) {
        return;
      }
      if (!scope) {
        setActionError(
          "Bot sessions are unavailable right now. Refresh and retry.",
        );
        return;
      }
      const live = (localSnapshot ?? snapshot).bots.find(
        (candidate) => candidate.id === bot.id,
      );
      if (!live) {
        setActionError(
          "That bot is no longer in the snapshot; refresh and retry.",
        );
        return;
      }
      // Gap 2 (task_926fddc5e769) + Defect 1: a Bot is bound to ONE
      // session. The host's resolution says FOCUS (live), REOPEN (known
      // exited -- dispatch a fresh session that resumes the harness's own
      // conversation), OPEN (no record -- a fresh session is correct), or
      // UNKNOWN (recorded but liveness not established). `forceNew` is the
      // explicit "start a fresh session" path and skips all of this. The
      // UNKNOWN case is the actual bug this fixes: it must never fall
      // through to a dispatch, or the first click duplicates the session.
      let resume = false;
      let resumeNotice: string | null = null;
      if (!options?.forceNew && resolveBotSession) {
        const resolution = resolveBotSession({ bot: live });
        if (resolution.kind === "focus") {
          setSelectedBotId(bot.id);
          await onOpenSession?.({
            botId: bot.id,
            sessionId: resolution.session.sessionId,
            incarnation: resolution.session.incarnation,
            harness: {
              harnessId:
                resolution.session.harnessId ??
                live.harnessPolicy.defaultHarness,
              explicitModel: live.harnessPolicy.explicitModel,
            },
            workspaceId: resolution.session.workspaceId,
            hostId: resolution.session.hostId,
            displayName: live.displayIdentity.displayName,
            handle: live.displayIdentity.handle,
            title: live.displayIdentity.title,
          });
          return;
        }
        if (resolution.kind === "unknown") {
          setActionError(
            "The daemon has not reported whether this Bot's session is still running, so opening another one could create a duplicate. Refresh and retry in a moment.",
          );
          return;
        }
        if (resolution.kind === "reopen") {
          const harnessId =
            resolution.harnessId ?? live.harnessPolicy.defaultHarness;
          // Resume only through a harness that actually supports it; a
          // harness without a resume mechanism gets a fresh session AND an
          // honest notice, never a pretend continuation.
          resume = harnessSupportsConversationResume(harnessId);
          if (!resume) {
            resumeNotice = `${harnessId} cannot reopen its previous conversation; a NEW session was opened instead.`;
          }
        }
        // kind === "open": nothing recorded; a fresh session is correct.
      }
      const botRun = bridge?.botRun;
      if (!botRun) {
        setActionError(
          "Bot sessions are unavailable: the daemon bridge is not connected. Refresh and retry.",
        );
        return;
      }
      setBusy(true);
      setActionError(null);
      try {
        const response = await dispatchOpenBotSession({
          bridge,
          scope,
          bot: live,
          requestId: mintRequestId("bot-open-session"),
          resume,
        });
        if (!response) {
          setActionError(
            "Bot sessions are unavailable: the daemon bridge is not connected. Refresh and retry.",
          );
          return;
        }
        if (!response.ok) {
          setActionError(response.error.message);
          return;
        }
        if (response.result.outcome !== "dispatched") {
          setActionError(
            response.result.error ??
              `The daemon ${response.result.outcome} the session. Refresh and retry.`,
          );
          return;
        }
        setSelectedBotId(bot.id);
        const opened = response.result.session;
        if (opened) {
          await onOpenSession?.({
            botId: bot.id,
            sessionId: opened.sessionId,
            incarnation: opened.incarnation,
            harness: {
              harnessId: live.harnessPolicy.defaultHarness,
              explicitModel: live.harnessPolicy.explicitModel,
            },
            workspaceId: response.result.workspaceId,
            hostId: response.result.hostId,
            displayName: live.displayIdentity.displayName,
            handle: live.displayIdentity.handle,
            title: live.displayIdentity.title,
          });
        }
        await load();
        if (resumeNotice) setActionError(resumeNotice);
      } catch (launchFailure) {
        setActionError(
          `Could not open the Bot session: ${errorMessage(launchFailure)}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [
      bridge,
      scope,
      busy,
      localSnapshot,
      snapshot,
      load,
      resolveBotSession,
      onOpenSession,
    ],
  );

  // Explicit expand/collapse of a bot card. The flip is over the card's
  // EFFECTIVE state (the design default — configured bots expanded,
  // unconfigured bots collapsed — or the user's last toggle), so the
  // first click on a default-expanded card collapses it.
  const toggleExpanded = useCallback(
    (botId: string): void => {
      const bot = (localSnapshot ?? snapshot).bots.find(
        (candidate) => candidate.id === botId,
      );
      const monitorCount = monitorsByBotId?.[botId]?.length ?? 0;
      const defaultExpanded = bot
        ? !isBotUnconfigured(bot, monitorCount)
        : true;
      setExpandedOverrides((current) => ({
        ...current,
        [botId]: !(current[botId] ?? defaultExpanded),
      }));
    },
    [localSnapshot, snapshot, monitorsByBotId],
  );

  return {
    effective,
    loading,
    loadError,
    showCreateForm,
    setShowCreateForm,
    createForm,
    setCreateForm,
    selectedBotId,
    setSelectedBotId,
    selectedBot,
    showResponsibilityForm,
    setShowResponsibilityForm,
    responsibilityForm,
    setResponsibilityForm,
    busy,
    actionError,
    refresh: load,
    submitCreate,
    submitResponsibility,
    deleteBot,
    runResponsibility,
    launchBot,
    automationSummaries,
    monitorsByBotId,
    expandedOverrides,
    toggleExpanded,
    filterQuery,
    setFilterQuery,
  };
}

export default useBotsPageController;
