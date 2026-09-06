// Candidate port of Lovecast Inc. MIT source
// src/renderer/src/app-shell/shutdown-checkpoint-restart-lifecycle.test.ts at
// c97906287bb7a390b25e2025b600d9fb3c25d9c3
// (SHA256 4dc096bd4c6ce625efc4f730e970368a67ee10a3ef4fa9b202f9ceadbba07444).
// Assertions preserved without weakening. The former faithful inline
// updater-beforeunload copy was removed per the persisted-renderer-contract
// migration: the harness now imports the real candidate implementation at
// apps/desktop/src/renderer/src/lib/updater-beforeunload.ts.

// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ORCA_APP_RESTART_ABORTED_EVENT,
  ORCA_APP_RESTART_STARTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT,
} from "../../../../../apps/desktop/src/shared/updater-renderer-events";
import {
  ORCA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT,
  ORCA_RENDERER_UNLOAD_PREVENTED_EVENT,
} from "../../../../../apps/desktop/src/shared/renderer-shutdown-events";
import { prepareRendererForAppRestart } from "../../../../../apps/desktop/src/shared/renderer-restart-preparation";
import {
  createShutdownCheckpointBeforeUnloadHandler,
  createShutdownCheckpointGuard,
} from "../../../../../apps/desktop/src/renderer/src/lib/shutdown-checkpoint-guard";
import {
  isIntentionalAppRestartInProgress,
  registerUpdaterBeforeUnloadBypass,
} from "../../../../../apps/desktop/src/renderer/src/lib/updater-beforeunload";
import {
  createShutdownCheckpointPersist,
  type ShutdownCheckpointPersistDeps,
} from "../../../../../apps/desktop/src/renderer/src/app-shell/shutdown-checkpoint-persist";

type LifecycleHarness = {
  cleanup: () => void;
  prepare: () => Promise<void>;
  stageBeforeUnloadSync: ReturnType<typeof vi.fn>;
};

type LifecycleFixtureSnapshot = { state: { activeTabId: string } };
type LifecycleFixtureUi = { activeView: "workspace" };

type LifecycleHarnessOverrides = Partial<
  Pick<
    ShutdownCheckpointPersistDeps<LifecycleFixtureSnapshot, LifecycleFixtureUi>,
    "buildSessionSnapshots" | "hasDirtyOpenFiles"
  >
>;

function createLifecycleHarness(
  startedEventName: string,
  abortedEventName: string,
  overrides: LifecycleHarnessOverrides = {},
): LifecycleHarness {
  const stageBeforeUnloadSync = vi.fn((args: { sessions: unknown[] }) => {
    if (args.sessions.length > 0) {
      throw new Error("deterministic full-stage failure");
    }
  });
  const persist = createShutdownCheckpointPersist({
    shouldCaptureSession: () => true,
    captureTerminalBuffers: vi.fn(),
    captureSleepingAgentSessions: vi.fn(),
    buildSessionSnapshots: () => [{ state: { activeTabId: "t1" } }],
    buildUiPatch: () => ({ activeView: "workspace" }),
    hasDirtyOpenFiles: () => false,
    isDegradableShutdownInProgress: isIntentionalAppRestartInProgress,
    stageBeforeUnloadSync,
    recordCrashBreadcrumb: vi.fn(),
    ...overrides,
  });
  const breadcrumbSink = vi.fn();
  const guard = createShutdownCheckpointGuard(persist.run, breadcrumbSink, persist.abandonAttempt);
  const checkpoint = createShutdownCheckpointBeforeUnloadHandler(guard);
  const cleanupRestartTracking = registerUpdaterBeforeUnloadBypass();
  window.addEventListener("beforeunload", checkpoint);
  window.addEventListener(
    ORCA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT,
    guard.abortAfterCheckpointFailure,
  );
  window.addEventListener(abortedEventName, guard.abandonAttempt);
  window.addEventListener(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT, guard.abandonAttempt);
  return {
    stageBeforeUnloadSync,
    prepare: () =>
      prepareRendererForAppRestart(window, {
        startedEventName,
        abortedEventName,
        awaitCheckpoint: () => Promise.resolve(),
      }),
    cleanup: () => {
      cleanupRestartTracking();
      window.removeEventListener("beforeunload", checkpoint);
      window.removeEventListener(
        ORCA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT,
        guard.abortAfterCheckpointFailure,
      );
      window.removeEventListener(abortedEventName, guard.abandonAttempt);
      window.removeEventListener(
        ORCA_RENDERER_UNLOAD_PREVENTED_EVENT,
        guard.abandonAttempt,
      );
    },
  };
}

function installWindowStub(): void {
  const attributes = new Map<string, string>();
  const eventTarget = new EventTarget();
  vi.stubGlobal("window", eventTarget);
  vi.stubGlobal("document", {
    documentElement: {
      getAttribute: (name: string) => attributes.get(name) ?? null,
      removeAttribute: (name: string) => {
        attributes.delete(name);
      },
      setAttribute: (name: string, value: string) => {
        attributes.set(name, value);
      },
    },
  });
}

describe("shutdown checkpoint restart lifecycle", () => {
  const cleanupFns: (() => void)[] = [];

  afterEach(() => {
    cleanupFns.splice(0).forEach((cleanup) => cleanup());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    {
      lifecycle: "app restart",
      startedEventName: ORCA_APP_RESTART_STARTED_EVENT,
      abortedEventName: ORCA_APP_RESTART_ABORTED_EVENT,
    },
    {
      lifecycle: "updater install",
      startedEventName: ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT,
      abortedEventName: ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
    },
  ])(
    "preserves retry-then-degrade across a checkpoint-caused $lifecycle abort",
    async ({ startedEventName, abortedEventName }) => {
      installWindowStub();
      vi.spyOn(console, "error").mockImplementation(() => {});
      const harness = createLifecycleHarness(startedEventName, abortedEventName);
      cleanupFns.push(harness.cleanup);

      await expect(harness.prepare()).rejects.toThrow("deterministic full-stage failure");
      expect(isIntentionalAppRestartInProgress()).toBe(false);
      await expect(harness.prepare()).resolves.toBeUndefined();

      expect(harness.stageBeforeUnloadSync).toHaveBeenCalledTimes(3);
      expect(harness.stageBeforeUnloadSync).toHaveBeenLastCalledWith({
        sessions: [],
        ui: { activeView: "workspace" },
      });
    },
  );

  it("abandons retry state when a later restart attempt is independently canceled", async () => {
    installWindowStub();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const harness = createLifecycleHarness(
      ORCA_APP_RESTART_STARTED_EVENT,
      ORCA_APP_RESTART_ABORTED_EVENT,
    );
    cleanupFns.push(harness.cleanup);

    await expect(harness.prepare()).rejects.toThrow("deterministic full-stage failure");
    window.dispatchEvent(new Event(ORCA_APP_RESTART_STARTED_EVENT));
    window.dispatchEvent(new Event(ORCA_APP_RESTART_ABORTED_EVENT));
    await expect(harness.prepare()).rejects.toThrow("deterministic full-stage failure");

    expect(harness.stageBeforeUnloadSync).toHaveBeenCalledTimes(2);
  });

  // Mirrors the e2e fixture in
  // tests/e2e/update-install-renderer-checkpoint-recovery.spec.ts in the
  // pinned source (STA-5668).
  it("names the snapshot-build cause when dirty drafts block the checkpoint", async () => {
    installWindowStub();
    const snapshotFailure = "Cannot read properties of null (reading 'toLowerCase')";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const harness = createLifecycleHarness(
      ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT,
      ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
      {
        buildSessionSnapshots: () => {
          throw new Error(snapshotFailure);
        },
        hasDirtyOpenFiles: () => true,
      },
    );
    cleanupFns.push(harness.cleanup);

    await expect(harness.prepare()).rejects.toThrow(
      new Error(`Renderer shutdown checkpoint was not completed: ${snapshotFailure}`),
    );
    // Dirty drafts must block before any durable-only degrade stages over them.
    expect(harness.stageBeforeUnloadSync).not.toHaveBeenCalled();
  });
});
