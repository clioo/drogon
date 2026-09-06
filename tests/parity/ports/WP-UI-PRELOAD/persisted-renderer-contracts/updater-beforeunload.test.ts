// Candidate port of Lovecast Inc. MIT source
// src/renderer/src/lib/updater-beforeunload.test.ts at
// c97906287bb7a390b25e2025b600d9fb3c25d9c3. All 4 source cases preserved
// unchanged against the real candidate implementation port at
// apps/desktop/src/renderer/src/lib/updater-beforeunload.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isIntentionalAppRestartInProgress,
  isUpdaterQuitAndInstallInProgress,
  registerUpdaterBeforeUnloadBypass,
} from "../../../../../apps/desktop/src/renderer/src/lib/updater-beforeunload";
import {
  ORCA_APP_RESTART_ABORTED_EVENT,
  ORCA_APP_RESTART_STARTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT,
} from "../../../../../apps/desktop/src/shared/updater-renderer-events";
import { ORCA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT } from "../../../../../apps/desktop/src/shared/renderer-shutdown-events";

type WindowEventStub = Pick<
  Window,
  "addEventListener" | "removeEventListener" | "dispatchEvent"
>;

beforeEach(() => {
  const eventTarget = new EventTarget();
  vi.stubGlobal("window", {
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
  } satisfies WindowEventStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("registerUpdaterBeforeUnloadBypass", () => {
  it("tracks updater quit-and-install lifecycle events", () => {
    const cleanup = registerUpdaterBeforeUnloadBypass();
    expect(isUpdaterQuitAndInstallInProgress()).toBe(false);

    window.dispatchEvent(new Event(ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT));
    expect(isUpdaterQuitAndInstallInProgress()).toBe(true);
    expect(isIntentionalAppRestartInProgress()).toBe(true);

    window.dispatchEvent(new Event(ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT));
    expect(isUpdaterQuitAndInstallInProgress()).toBe(false);
    expect(isIntentionalAppRestartInProgress()).toBe(false);

    cleanup();
  });

  it("tracks app restart lifecycle events", () => {
    const cleanup = registerUpdaterBeforeUnloadBypass();
    expect(isIntentionalAppRestartInProgress()).toBe(false);

    window.dispatchEvent(new Event(ORCA_APP_RESTART_STARTED_EVENT));
    expect(isIntentionalAppRestartInProgress()).toBe(true);
    expect(isUpdaterQuitAndInstallInProgress()).toBe(true);

    window.dispatchEvent(new Event(ORCA_APP_RESTART_ABORTED_EVENT));
    expect(isIntentionalAppRestartInProgress()).toBe(false);

    cleanup();
  });

  it("ends restart progress when the shutdown checkpoint aborts preparation", () => {
    const cleanup = registerUpdaterBeforeUnloadBypass();

    window.dispatchEvent(new Event(ORCA_APP_RESTART_STARTED_EVENT));
    window.dispatchEvent(new Event(ORCA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT));

    expect(isIntentionalAppRestartInProgress()).toBe(false);
    cleanup();
  });

  it("resets the bypass flag during cleanup", () => {
    const cleanup = registerUpdaterBeforeUnloadBypass();

    window.dispatchEvent(new Event(ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT));
    expect(isUpdaterQuitAndInstallInProgress()).toBe(true);

    cleanup();
    expect(isUpdaterQuitAndInstallInProgress()).toBe(false);
  });
});
