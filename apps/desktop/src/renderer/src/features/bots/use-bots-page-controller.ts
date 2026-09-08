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

  const [loading, setLoading] = useState(false);
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
