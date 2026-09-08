// MIT Copyright (c) 2026 Lovecast Inc.
import { describe, expect, it } from "vitest";
import { createAppActivityGuard } from "./app-activity-guard";

describe("createAppActivityGuard", () => {
  it("holds a prevent-app-suspension blocker in background-test mode", () => {
    const stopped: number[] = [];
    let nextId = 1;
    const guard = createAppActivityGuard({
      isBackgroundTestMode: true,
      start: () => nextId++,
      stop: (id) => stopped.push(id),
    });
    expect(guard.active).toBe(false);
    expect(guard.startIfNeeded()).toBe(true);
    expect(guard.active).toBe(true);
    guard.release();
    expect(stopped).toEqual([1]);
    expect(guard.active).toBe(false);
  });

  it("never starts a blocker for a foreground (user-activated) instance", () => {
    let starts = 0;
    const guard = createAppActivityGuard({
      isBackgroundTestMode: false,
      start: () => {
        starts += 1;
        return 1;
      },
      stop: () => {},
    });
    expect(guard.startIfNeeded()).toBe(false);
    expect(guard.active).toBe(false);
    expect(starts).toBe(0);
    // Releasing an unused guard is a no-op, never a stray stop().
    guard.release();
    expect(guard.active).toBe(false);
  });

  it("is idempotent: repeated starts stack exactly one blocker", () => {
    let starts = 0;
    const stopped: number[] = [];
    const guard = createAppActivityGuard({
      isBackgroundTestMode: true,
      start: () => {
        starts += 1;
        return 7;
      },
      stop: (id) => stopped.push(id),
    });
    expect(guard.startIfNeeded()).toBe(true);
    expect(guard.startIfNeeded()).toBe(true);
    expect(guard.startIfNeeded()).toBe(true);
    expect(starts).toBe(1);
    guard.release();
    guard.release();
    expect(stopped).toEqual([7]);
    // A released guard can be re-armed (relaunch-style lifecycle reuse).
    expect(guard.startIfNeeded()).toBe(true);
    expect(starts).toBe(2);
    guard.release();
    expect(stopped).toEqual([7, 7]);
  });

  it("does not claim liveness when the platform refuses the blocker", () => {
    const guard = createAppActivityGuard({
      isBackgroundTestMode: true,
      start: () => 0,
      stop: () => {},
    });
    expect(guard.startIfNeeded()).toBe(false);
    expect(guard.active).toBe(false);
  });
});
