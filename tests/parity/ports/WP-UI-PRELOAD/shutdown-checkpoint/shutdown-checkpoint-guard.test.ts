// Candidate port of Lovecast Inc. MIT source
// src/renderer/src/lib/shutdown-checkpoint-guard.test.ts at
// c97906287bb7a390b25e2025b600d9fb3c25d9c3
// (SHA256 25d1c5e6fdac50e2f3b6ff0fa7e1ea830372b32f2459b7e8184059bb15f8371d).
// The 13 behavioral cases are preserved without weakening under a node
// environment with explicit window/document stubs (candidate tooling has no
// happy-dom). The source suite's two caller-wiring pin cases read caller
// source bytes (use-terminal-editor-close-foundation.ts /
// use-terminal-window-lifecycle.ts); callers are outside this leaf's scope and
// those pins are fully reproduced in the pinned-source capsule baseline
// (15/15) and remain root implementation-map items.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createShutdownCheckpointBeforeUnloadHandler,
  createShutdownCheckpointGuard,
  preventUnloadAndScheduleShutdownCheckpointReset,
} from "../../../../../apps/desktop/src/renderer/src/lib/shutdown-checkpoint-guard";
import {
  consumeShutdownCheckpointFailureReason,
  ORCA_RENDERER_SHUTDOWN_CHECKPOINT_FAILED_EVENT,
  ORCA_RENDERER_UNLOAD_PREVENTED_EVENT,
} from "../../../../../apps/desktop/src/shared/renderer-shutdown-events";

function installRendererGlobals(): void {
  const attributes = new Map<string, string>();
  const eventTarget = new EventTarget() as EventTarget & {
    api?: unknown;
  };
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

describe("createShutdownCheckpointGuard", () => {
  beforeEach(() => {
    installRendererGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    consumeShutdownCheckpointFailureReason();
  });

  it("dedupes the synthetic and native unload events in one close attempt", () => {
    const persist = vi.fn();
    const sink = vi.fn();
    const guard = createShutdownCheckpointGuard(persist, sink);

    expect(guard.persistOnce()).toBe(true);
    expect(guard.persistOnce()).toBe(true);

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("allows a new checkpoint after an aborted restart resets the attempt", () => {
    const persist = vi.fn();
    const guard = createShutdownCheckpointGuard(persist, vi.fn());

    expect(guard.persistOnce()).toBe(true);
    guard.abandonAttempt();
    expect(guard.persistOnce()).toBe(true);

    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("retries when the blocking checkpoint throws", () => {
    const persist = vi.fn().mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    const guard = createShutdownCheckpointGuard(persist, vi.fn());

    expect(guard.persistOnce()).toBe(false);
    expect(guard.persistOnce()).toBe(true);

    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("publishes the failure cause and records a crash breadcrumb (STA-5505)", () => {
    // Root contract adaptation: the injected sink is a signature-only adapter
    // from the candidate (name, data) form to the source recorder envelope
    // recordBreadcrumb({ name, data }); the original assertion object
    // envelope below is preserved unchanged.
    const recordBreadcrumb = vi.fn();
    const sink = (name: string, data: { message: string }): void =>
      recordBreadcrumb({ name, data });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const guard = createShutdownCheckpointGuard(() => {
      throw new Error("sendSync payload rejected");
    }, sink);

    expect(guard.persistOnce()).toBe(false);

    expect(consumeShutdownCheckpointFailureReason()).toBe(
      "sendSync payload rejected",
    );
    expect(recordBreadcrumb).toHaveBeenCalledWith({
      name: "renderer_shutdown_checkpoint_failed",
      data: { message: "sendSync payload rejected" },
    });
  });

  it("clears a stale failure cause once a later checkpoint succeeds (STA-5505)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sink = vi.fn();
    const guard = createShutdownCheckpointGuard(
      vi.fn().mockImplementationOnce(() => {
        throw new Error("disk full");
      }),
      sink,
    );

    expect(guard.persistOnce()).toBe(false);
    expect(guard.persistOnce()).toBe(true);

    expect(consumeShutdownCheckpointFailureReason()).toBeNull();
  });

  it("keeps failure reporting non-throwing for unstringifiable thrown values", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sink = vi.fn();
    const guard = createShutdownCheckpointGuard(() => {
      throw Object.create(null);
    }, sink);

    expect(guard.persistOnce()).toBe(false);
    expect(consumeShutdownCheckpointFailureReason()).toBe(
      "Unknown shutdown checkpoint failure",
    );
  });

  it("uses a fallback reason when an Error has an empty message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("placeholder");
    error.message = "";
    const sink = vi.fn();
    const guard = createShutdownCheckpointGuard(() => {
      throw error;
    }, sink);

    expect(guard.persistOnce()).toBe(false);
    expect(consumeShutdownCheckpointFailureReason()).toBe(
      "Unknown shutdown checkpoint failure",
    );
  });

  it("resets state owned by the persist attempt lifecycle", () => {
    const abandonPersistAttempt = vi.fn();
    const guard = createShutdownCheckpointGuard(vi.fn(), vi.fn(), abandonPersistAttempt);

    guard.abandonAttempt();

    expect(abandonPersistAttempt).toHaveBeenCalledTimes(1);
  });

  it("preserves persist retry state when the checkpoint itself aborts the restart", () => {
    const abandonPersistAttempt = vi.fn();
    const guard = createShutdownCheckpointGuard(vi.fn(), vi.fn(), abandonPersistAttempt);

    guard.abortAfterCheckpointFailure();

    expect(abandonPersistAttempt).not.toHaveBeenCalled();
  });

  it("reports checkpoint failure separately from the unload verdict", () => {
    const eventTarget = new EventTarget();
    const failed = vi.fn();
    const guard = createShutdownCheckpointGuard(() => {
      throw new Error("invalid session");
    }, vi.fn());
    eventTarget.addEventListener(
      ORCA_RENDERER_SHUTDOWN_CHECKPOINT_FAILED_EVENT,
      failed,
    );
    eventTarget.addEventListener(
      "beforeunload",
      createShutdownCheckpointBeforeUnloadHandler(guard),
    );

    expect(
      eventTarget.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(false);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("retries after a prevented reload resets the completed checkpoint", () => {
    const eventTarget = new EventTarget();
    const persist = vi.fn();
    const guard = createShutdownCheckpointGuard(persist, vi.fn());
    const checkpoint = createShutdownCheckpointBeforeUnloadHandler(guard);
    const preventReload = (event: Event): void => event.preventDefault();
    eventTarget.addEventListener("beforeunload", checkpoint);
    eventTarget.addEventListener("beforeunload", preventReload);

    expect(
      eventTarget.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(false);
    guard.abandonAttempt();
    eventTarget.removeEventListener("beforeunload", preventReload);
    expect(
      eventTarget.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(true);

    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("cancels unload when persistence fails and remains retryable", () => {
    const eventTarget = new EventTarget();
    const persist = vi.fn().mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    const guard = createShutdownCheckpointGuard(persist, vi.fn());
    const checkpoint = createShutdownCheckpointBeforeUnloadHandler(guard);
    eventTarget.addEventListener("beforeunload", checkpoint);

    expect(
      eventTarget.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(false);
    expect(
      eventTarget.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(true);

    expect(persist).toHaveBeenCalledTimes(2);
  });

  // Strengthening (root contract): a throwing sink must never mask the
  // checkpoint outcome or the failure-reason publication.
  it("strengthening: keeps failure reporting intact when the injected breadcrumb sink throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const guard = createShutdownCheckpointGuard(() => {
      throw new Error("disk full");
    }, () => {
      throw new Error("breadcrumb sink exploded");
    });

    expect(guard.persistOnce()).toBe(false);
    expect(consumeShutdownCheckpointFailureReason()).toBe("disk full");
  });

  it("resets after a paired-web dirty-file veto regardless of listener order", async () => {
    const eventTarget = new EventTarget();
    const persist = vi.fn();
    const guard = createShutdownCheckpointGuard(persist, vi.fn());
    const preventReload = (event: Event): void => {
      preventUnloadAndScheduleShutdownCheckpointReset(event, eventTarget);
    };
    eventTarget.addEventListener("beforeunload", preventReload);
    eventTarget.addEventListener(
      "beforeunload",
      createShutdownCheckpointBeforeUnloadHandler(guard),
    );
    eventTarget.addEventListener(
      ORCA_RENDERER_UNLOAD_PREVENTED_EVENT,
      guard.abandonAttempt,
    );

    expect(
      eventTarget.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(false);
    await Promise.resolve();
    eventTarget.removeEventListener("beforeunload", preventReload);
    expect(
      eventTarget.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(true);

    expect(persist).toHaveBeenCalledTimes(2);
  });
});
