import { describe, expect, it } from "vitest";
import { computeAutosavePlan } from "./editor-autosave-controller";

describe("computeAutosavePlan", () => {
  it("schedules when dirty, admissible, and no save in flight", () => {
    expect(
      computeAutosavePlan({
        key: "host/ws/a.ts",
        dirty: true,
        saveInFlight: false,
        readConfirmedOrAllowEmpty: true,
      }),
    ).toEqual({ action: "schedule", key: "host/ws/a.ts" });
  });

  it("cancels when nothing is open", () => {
    expect(
      computeAutosavePlan({
        key: null,
        dirty: true,
        saveInFlight: false,
        readConfirmedOrAllowEmpty: true,
      }),
    ).toEqual({ action: "cancel", key: null });
  });

  it("cancels when clean", () => {
    expect(
      computeAutosavePlan({
        key: "host/ws/a.ts",
        dirty: false,
        saveInFlight: false,
        readConfirmedOrAllowEmpty: true,
      }),
    ).toEqual({ action: "cancel", key: "host/ws/a.ts" });
  });

  it("cancels while a save is already in flight (the queue will re-evaluate after it settles)", () => {
    expect(
      computeAutosavePlan({
        key: "host/ws/a.ts",
        dirty: true,
        saveInFlight: true,
        readConfirmedOrAllowEmpty: true,
      }),
    ).toEqual({ action: "cancel", key: "host/ws/a.ts" });
  });

  it("cancels an unread file with no new-file intent", () => {
    expect(
      computeAutosavePlan({
        key: "host/ws/a.ts",
        dirty: true,
        saveInFlight: false,
        readConfirmedOrAllowEmpty: false,
      }),
    ).toEqual({ action: "cancel", key: "host/ws/a.ts" });
  });

  // Fork parity (isAutosaveSuspendedForFile): while the disk moved out from
  // under a dirty draft, the timer must not silently overwrite the newer
  // external content — only an explicit user save resolves the conflict.
  it("cancels while changed-on-disk suspends autosave", () => {
    expect(
      computeAutosavePlan({
        key: "host/ws/a.ts",
        dirty: true,
        saveInFlight: false,
        readConfirmedOrAllowEmpty: true,
        suspended: true,
      }),
    ).toEqual({ action: "cancel", key: "host/ws/a.ts" });
  });

  it("schedules when not suspended", () => {
    expect(
      computeAutosavePlan({
        key: "host/ws/a.ts",
        dirty: true,
        saveInFlight: false,
        readConfirmedOrAllowEmpty: true,
        suspended: false,
      }),
    ).toEqual({ action: "schedule", key: "host/ws/a.ts" });
  });
});
