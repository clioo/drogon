/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/use-bots-page-controller.ts.
   Adapters for this repo: no zustand store and no `window.api` — the
   snapshot, bridge, scope and run callback are injected by the caller (the
   mount owns snapshot loading and validation upstream, so the controller
   starts from props and reloads through `bridge.botSnapshot`). Selection
   opens this repo's detail view (list plus conversation surface) instead of
   highlighting a list row; the reload-after-every-mutation, error-alert,
   busy-gate and Escape semantics are the source's. `launchBot` is omitted:
   this surface has no worktree-session launcher — opening a session is the
   caller's `onRunResponsibility`-independent `onOpenSession`. `run` invokes
   the caller's fire-and-forget callback (`bot.run` settles asynchronously
   behind the mount), so unlike the source it cannot reload after the run
   settles. */

import { useCallback, useEffect, useState } from "react";
import type {
  BotBridge,
  BotRunHarnessSource,
  BotScope,
  BotsPanelSnapshot,
} from "./bots-panel-contracts";
import {
  buildBotCreateBody,
  emptyBotCreateForm,
  emptyResponsibilityForm,
} from "./bots-page-model";

/** The App keep-alive host for the Bots page. Single source of truth
 *  shared by the host element and the Escape visibility check (same
 *  adaptation as features/tasks/task-page-global-escape.ts). */
export const BOTS_PAGE_HOST_TESTID = "bots-page-host";
export const BOTS_PAGE_HOST_SELECTOR = `[data-testid="${BOTS_PAGE_HOST_TESTID}"]`;
import type {
  BotCreateFormValues,
  ResponsibilityFormValues,
} from "./bots-page-model";

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
  const { snapshot, bridge, scope, onClose, onRunResponsibility } = deps;

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
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [showResponsibilityForm, setShowResponsibilityForm] = useState(false);
  const [responsibilityForm, setResponsibilityForm] =
    useState<ResponsibilityFormValues>(emptyResponsibilityForm());
  const [responsibilityBusy, setResponsibilityBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshSnapshot = useCallback(async () => {
    if (!bridge?.botSnapshot || !scope) return;
    const response = await bridge.botSnapshot(scope);
    if (response.ok) {
      setLocalSnapshot({
        bots: response.result.bots,
        history: response.result.history,
      });
    }
    return response;
  }, [bridge, scope]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await refreshSnapshot();
      if (response && !response.ok) {
        setLoadError(response.error.message);
      }
    } catch (refreshError) {
      setLoadError(errorMessage(refreshError));
    } finally {
      setLoading(false);
    }
  }, [refreshSnapshot]);

  const submitCreate = useCallback(async (): Promise<void> => {
    if (!bridge?.botCreate || !scope) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const response = await bridge.botCreate({
        ...scope,
        requestId: mintRequestId("bot-create"),
        body: buildBotCreateBody(createForm),
      });
      if (!response.ok) {
        setCreateError(response.error.message);
        return;
      }
      setShowCreateForm(false);
      setCreateForm(emptyBotCreateForm());
      setSelectedBotId(response.result.id);
      await refreshSnapshot();
    } catch (createFailure) {
      setCreateError(errorMessage(createFailure));
    } finally {
      setCreateBusy(false);
    }
  }, [bridge, scope, createForm, refreshSnapshot]);

  const submitResponsibility = useCallback(
    async (botId: string): Promise<void> => {
      if (!bridge?.botResponsibilityCreate || !scope) return;
      setResponsibilityBusy(true);
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
        await refreshSnapshot();
      } catch (responsibilityFailure) {
        setActionError(errorMessage(responsibilityFailure));
      } finally {
        setResponsibilityBusy(false);
      }
    },
    [bridge, scope, responsibilityForm, refreshSnapshot],
  );

  const deleteResponsibility = useCallback(
    async (botId: string, responsibilityId: string): Promise<void> => {
      if (!bridge?.botResponsibilityDelete || !scope) return;
      setActionError(null);
      try {
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
      } catch (deleteFailure) {
        setActionError(errorMessage(deleteFailure));
      }
    },
    [bridge, scope, refreshSnapshot],
  );

  const deleteBot = useCallback(
    async (botId: string): Promise<void> => {
      if (!bridge?.botDelete || !scope) return;
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
        if (selectedBotId === botId) {
          setSelectedBotId(null);
          setShowResponsibilityForm(false);
        }
        await refreshSnapshot();
      } catch (deleteFailure) {
        setActionError(errorMessage(deleteFailure));
      }
    },
    [bridge, scope, selectedBotId, refreshSnapshot],
  );

  // Manual run (R16-S): resolves the harness from the LIVE snapshot (never
  // the mount-time one, which predates in-panel mutations), awaits the
  // mount's `bot.run` call, then reloads so the new history row appears --
  // the fork's `await runResponsibility(); await load()`. Failures surface
  // in the action-error alert instead of vanishing into a void promise.
  const runResponsibility = useCallback(
    async (botId: string, responsibilityId: string): Promise<void> => {
      if (!onRunResponsibility) return;
      const bot = (localSnapshot ?? snapshot).bots.find(
        (candidate) => candidate.id === botId,
      );
      if (!bot) {
        setActionError("That bot is no longer in the snapshot; refresh and retry.");
        return;
      }
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
        await refreshSnapshot();
      } catch (runFailure) {
        setActionError(errorMessage(runFailure));
      }
    },
    [onRunResponsibility, localSnapshot, snapshot, refreshSnapshot],
  );

  const closeDetail = useCallback((): void => {
    setSelectedBotId(null);
    setShowResponsibilityForm(false);
    setActionError(null);
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
        } else if (selectedBotId !== null) {
          closeDetail();
        } else {
          onClose?.();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, showCreateForm, showResponsibilityForm, selectedBotId, closeDetail]);

  const selectedBot =
    selectedBotId !== null
      ? (effective.bots.find((bot) => bot.id === selectedBotId) ?? null)
      : null;

  return {
    effective,
    loading,
    loadError,
    showCreateForm,
    setShowCreateForm,
    createForm,
    setCreateForm,
    createBusy,
    createError,
    selectedBotId,
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
  };
}

export default useBotsPageController;
