// Supplemental candidate checks derived from Lovecast Inc. MIT source
// src/shared/renderer-restart-preparation.test.ts at c97906287bb7a390b25e2025b600d9fb3c25d9c3
// (SHA256 1d2e91f5883df3de697d2dab6f6cc6af82e3651736a12169b1926244f15e1bbf).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  prepareAndInvokeAppRestart,
  prepareAndInvokeUpdaterInstall,
} from "../../../../../apps/desktop/src/preload/renderer-restart-wiring";
import { ORCA_EDITOR_PREPARE_HOT_EXIT_EVENT } from "../../../../../apps/desktop/src/shared/editor-save-events";
import {
  ORCA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT,
  ORCA_RENDERER_SHUTDOWN_CHECKPOINT_FAILED_EVENT,
  clearShutdownCheckpointFailureReason,
  consumeShutdownCheckpointFailureReason,
  formatShutdownCheckpointFailureReason,
  publishShutdownCheckpointFailureReason,
} from "../../../../../apps/desktop/src/shared/renderer-shutdown-events";
import {
  createUpdaterQuitAbortRelay,
  prepareRendererForAppRestart,
} from "../../../../../apps/desktop/src/shared/renderer-restart-preparation";
import {
  ORCA_APP_RESTART_ABORTED_EVENT,
  ORCA_APP_RESTART_STARTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT,
} from "../../../../../apps/desktop/src/shared/updater-renderer-events";

function installDocumentAttributeStub(): void {
  const attributes = new Map<string, string>();
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

beforeEach(() => {
  installDocumentAttributeStub();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prepareRendererForAppRestart", () => {
  it("aborts separately when the dispatched checkpoint reports failure", async () => {
    const eventTarget = new EventTarget();
    const started = vi.fn();
    const aborted = vi.fn();
    const independentlyAborted = vi.fn();
    const checkpoint = vi.fn((event: Event) => {
      event.currentTarget?.dispatchEvent(
        new Event(ORCA_RENDERER_SHUTDOWN_CHECKPOINT_FAILED_EVENT),
      );
      event.preventDefault();
    });
    eventTarget.addEventListener("restart-started", started);
    eventTarget.addEventListener(
      ORCA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT,
      aborted,
    );
    eventTarget.addEventListener("restart-aborted", independentlyAborted);
    eventTarget.addEventListener("beforeunload", checkpoint);

    await expect(
      prepareRendererForAppRestart(eventTarget, {
        startedEventName: "restart-started",
        abortedEventName: "restart-aborted",
        awaitCheckpoint: () => Promise.resolve(),
      }),
    ).rejects.toThrow("Renderer shutdown checkpoint was not completed.");

    expect(started).toHaveBeenCalledTimes(1);
    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(independentlyAborted).not.toHaveBeenCalled();
  });

  it("includes and consumes the published checkpoint failure cause", async () => {
    const eventTarget = new EventTarget();
    eventTarget.addEventListener("beforeunload", (event) => {
      publishShutdownCheckpointFailureReason("sendSync payload rejected");
      event.currentTarget?.dispatchEvent(
        new Event(ORCA_RENDERER_SHUTDOWN_CHECKPOINT_FAILED_EVENT),
      );
      event.preventDefault();
    });

    await expect(
      prepareRendererForAppRestart(eventTarget, {
        startedEventName: "restart-started",
        abortedEventName: "restart-aborted",
        awaitCheckpoint: () => Promise.resolve(),
      }),
    ).rejects.toThrow(
      "Renderer shutdown checkpoint was not completed: sendSync payload rejected",
    );
    expect(consumeShutdownCheckpointFailureReason()).toBeNull();
  });

  it("does not mistake an unrelated unload veto for checkpoint failure", async () => {
    const eventTarget = new EventTarget();
    const veto = vi.fn((event: Event) => event.preventDefault());
    const awaitCheckpoint = vi.fn(() => Promise.resolve());
    eventTarget.addEventListener("beforeunload", veto);

    await prepareRendererForAppRestart(eventTarget, {
      startedEventName: "restart-started",
      abortedEventName: "restart-aborted",
      awaitCheckpoint,
    });

    expect(veto).toHaveBeenCalledTimes(1);
    expect(awaitCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("waits for the durable checkpoint write before resolving", async () => {
    const eventTarget = new EventTarget();
    const order: string[] = [];
    let releaseCheckpoint!: () => void;
    eventTarget.addEventListener("beforeunload", () => order.push("staged"));

    const prepared = prepareRendererForAppRestart(eventTarget, {
      startedEventName: "restart-started",
      abortedEventName: "restart-aborted",
      awaitCheckpoint: () =>
        new Promise<void>((resolve) => {
          order.push("awaiting-flush");
          releaseCheckpoint = () => {
            order.push("flushed");
            resolve();
          };
        }),
    });
    let settled = false;
    void prepared.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    releaseCheckpoint();
    await prepared;
    expect(order).toEqual(["staged", "awaiting-flush", "flushed"]);
  });

  it("aborts when staged state cannot be persisted", async () => {
    const eventTarget = new EventTarget();
    const aborted = vi.fn();
    eventTarget.addEventListener("restart-aborted", aborted);

    await expect(
      prepareRendererForAppRestart(eventTarget, {
        startedEventName: "restart-started",
        abortedEventName: "restart-aborted",
        awaitCheckpoint: () =>
          Promise.reject(new Error("Failed to persist renderer state.")),
      }),
    ).rejects.toThrow("Failed to persist renderer state.");
    expect(aborted).toHaveBeenCalledTimes(1);
  });

  it("waits for a claimed editor hot-exit backup before checkpointing", async () => {
    const eventTarget = new EventTarget();
    const order: string[] = [];
    let finishBackup!: () => void;
    eventTarget.addEventListener(ORCA_EDITOR_PREPARE_HOT_EXIT_EVENT, (event) => {
      const detail = (event as CustomEvent<{ claim(): void; resolve(): void }>).detail;
      detail.claim();
      order.push("backup-claimed");
      finishBackup = () => {
        order.push("backup-finished");
        detail.resolve();
      };
    });
    eventTarget.addEventListener("beforeunload", () => order.push("checkpoint-staged"));

    const prepared = prepareRendererForAppRestart(eventTarget, {
      startedEventName: "restart-started",
      abortedEventName: "restart-aborted",
      awaitCheckpoint: async () => {
        order.push("checkpoint-flushed");
      },
    });
    await Promise.resolve();
    expect(order).toEqual(["backup-claimed"]);

    finishBackup();
    await prepared;
    expect(order).toEqual([
      "backup-claimed",
      "backup-finished",
      "checkpoint-staged",
      "checkpoint-flushed",
    ]);
  });

  it("propagates a claimed editor backup failure before checkpointing", async () => {
    const eventTarget = new EventTarget();
    const checkpoint = vi.fn();
    const aborted = vi.fn();
    eventTarget.addEventListener(ORCA_EDITOR_PREPARE_HOT_EXIT_EVENT, (event) => {
      const detail = (
        event as CustomEvent<{
          claim(): void;
          reject(message: string): void;
        }>
      ).detail;
      detail.claim();
      detail.reject("Dirty editor backup failed.");
    });
    eventTarget.addEventListener("beforeunload", checkpoint);
    eventTarget.addEventListener("restart-aborted", aborted);

    await expect(
      prepareRendererForAppRestart(eventTarget, {
        startedEventName: "restart-started",
        abortedEventName: "restart-aborted",
        awaitCheckpoint: () => Promise.resolve(),
      }),
    ).rejects.toThrow("Dirty editor backup failed.");
    expect(checkpoint).not.toHaveBeenCalled();
    expect(aborted).toHaveBeenCalledTimes(1);
  });
});

describe("createUpdaterQuitAbortRelay", () => {
  it("aborts a prepared update once after async updater failure", () => {
    const eventTarget = new EventTarget();
    const aborted = vi.fn();
    eventTarget.addEventListener("update-restart-aborted", aborted);
    const relay = createUpdaterQuitAbortRelay(
      eventTarget,
      "update-restart-aborted",
    );
    relay.markPrepared();

    relay.handleStatus({ state: "error", message: "install failed" });
    relay.handleStatus({ state: "error", message: "duplicate failure" });
    expect(aborted).toHaveBeenCalledTimes(1);
  });

  it("aborts a prepared linux package recovery failure", () => {
    const eventTarget = new EventTarget();
    const aborted = vi.fn();
    eventTarget.addEventListener("update-restart-aborted", aborted);
    const relay = createUpdaterQuitAbortRelay(
      eventTarget,
      "update-restart-aborted",
    );
    relay.markPrepared();

    relay.handleStatus({
      state: "error",
      message: "No authentication agent found.",
      recovery: {
        kind: "linux-package-install",
        packageType: "deb",
        reason: "authentication-agent-unavailable",
        version: "1.0.61",
      },
    });
    expect(aborted).toHaveBeenCalledTimes(1);
  });

  it("ignores updater errors before a restart is prepared", () => {
    const eventTarget = new EventTarget();
    const aborted = vi.fn();
    eventTarget.addEventListener("update-restart-aborted", aborted);
    const relay = createUpdaterQuitAbortRelay(
      eventTarget,
      "update-restart-aborted",
    );

    relay.handleStatus({ state: "error", message: "check failed" });
    expect(aborted).not.toHaveBeenCalled();
  });
});

describe("restart invocation boundaries", () => {
  it("marks update preparation only after the checkpoint flush", async () => {
    const calls: string[] = [];
    const eventTarget = new EventTarget();
    eventTarget.addEventListener(
      ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT,
      () => calls.push("started"),
    );

    await prepareAndInvokeUpdaterInstall(
      eventTarget,
      {
        markPrepared: () => calls.push("marked"),
        abort: () => calls.push("aborted"),
      },
      async () => {
        calls.push("invoked");
      },
      async () => {
        calls.push("checkpoint-flushed");
      },
    );

    expect(calls).toEqual(["started", "checkpoint-flushed", "marked", "invoked"]);
  });

  it("dispatches the app-aborted event when restart invocation fails", async () => {
    const eventTarget = new EventTarget();
    const started = vi.fn();
    const aborted = vi.fn();
    eventTarget.addEventListener(ORCA_APP_RESTART_STARTED_EVENT, started);
    eventTarget.addEventListener(ORCA_APP_RESTART_ABORTED_EVENT, aborted);

    await expect(
      prepareAndInvokeAppRestart(
        eventTarget,
        () => Promise.reject(new Error("restart IPC failed")),
        () => Promise.resolve(),
      ),
    ).rejects.toThrow("restart IPC failed");
    expect(started).toHaveBeenCalledTimes(1);
    expect(aborted).toHaveBeenCalledTimes(1);
  });

  it("invokes app restart only after its durable checkpoint", async () => {
    const eventTarget = new EventTarget();
    const calls: string[] = [];
    eventTarget.addEventListener(ORCA_APP_RESTART_STARTED_EVENT, () =>
      calls.push("started"),
    );

    await prepareAndInvokeAppRestart(
      eventTarget,
      async () => {
        calls.push("invoked");
      },
      async () => {
        calls.push("checkpoint-flushed");
      },
    );

    expect(calls).toEqual(["started", "checkpoint-flushed", "invoked"]);
  });

  it("never invokes app restart after checkpoint persistence fails", async () => {
    const eventTarget = new EventTarget();
    const invoke = vi.fn();
    const aborted = vi.fn();
    eventTarget.addEventListener(ORCA_APP_RESTART_ABORTED_EVENT, aborted);

    await expect(
      prepareAndInvokeAppRestart(
        eventTarget,
        invoke,
        () => Promise.reject(new Error("checkpoint write failed")),
      ),
    ).rejects.toThrow("checkpoint write failed");
    expect(invoke).not.toHaveBeenCalled();
    expect(aborted).toHaveBeenCalledTimes(1);
  });

  it("uses distinct update and app restart lifecycle event names", () => {
    expect(ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT).not.toBe(
      ORCA_APP_RESTART_STARTED_EVENT,
    );
    expect(ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT).not.toBe(
      ORCA_APP_RESTART_ABORTED_EVENT,
    );
  });
});

describe("shutdown checkpoint failure reason fallbacks", () => {
  it("formats ordinary, empty, and unstringifiable failures without throwing", () => {
    const empty = new Error("placeholder");
    empty.message = "";
    expect(formatShutdownCheckpointFailureReason(new Error("disk full"))).toBe(
      "disk full",
    );
    expect(formatShutdownCheckpointFailureReason(empty)).toBe(
      "Unknown shutdown checkpoint failure",
    );
    expect(formatShutdownCheckpointFailureReason(Object.create(null))).toBe(
      "Unknown shutdown checkpoint failure",
    );
  });

  it("clears a published reason idempotently", () => {
    publishShutdownCheckpointFailureReason("disk full");
    clearShutdownCheckpointFailureReason();
    expect(consumeShutdownCheckpointFailureReason()).toBeNull();
    clearShutdownCheckpointFailureReason();
    expect(consumeShutdownCheckpointFailureReason()).toBeNull();
  });
});
