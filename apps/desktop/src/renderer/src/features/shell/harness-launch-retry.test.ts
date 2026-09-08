// MIT Copyright (c) 2026 Lovecast Inc.
// R16-AJ2 follow-up (issue #221): Retry must relaunch a failed harness
// launch with the SAME inputs (provider/model/prompt), never a refresh or
// bare defaults. Covers the memory projection and the exact retry payload.
import { describe, expect, test } from "vitest";
import type { HarnessLaunchInput } from "../../../../shared/session-contract";
import {
  buildHarnessLaunchRetry,
  harnessLaunchForRetry,
  rememberHarnessLaunch,
} from "./harness-launch-retry";

const launch: HarnessLaunchInput = {
  workspaceId: "ws-1",
  harnessId: "pi",
  model: "qwen3.8-flash-next-nvidia-nvfp4",
  provider: "dgx-spark",
  effort: "high",
  prompt: "say hello",
  permissionMode: "unattended",
  requestId: "req-1",
};

describe("harnessLaunchForRetry", () => {
  test("returns the remembered inputs for the session the launch produced", () => {
    const memory = new Map();
    rememberHarnessLaunch(memory, { id: "s-1" }, launch);
    expect(
      harnessLaunchForRetry(memory, { id: "s-1", harnessId: "pi" }),
    ).toEqual(launch);
  });

  test("never offers a relaunch for plain shells or unknown sessions", () => {
    const memory = new Map();
    rememberHarnessLaunch(memory, { id: "s-1" }, launch);
    expect(
      harnessLaunchForRetry(memory, { id: "s-2", harnessId: null }),
    ).toBeNull();
    expect(
      harnessLaunchForRetry(memory, { id: "s-9", harnessId: "pi" }),
    ).toBeNull();
  });
});

describe("buildHarnessLaunchRetry", () => {
  test("keeps every launch input and replaces only the requestId", () => {
    const retry = buildHarnessLaunchRetry(launch, "req-2");
    expect(retry).toEqual({
      workspaceId: "ws-1",
      harnessId: "pi",
      model: "qwen3.8-flash-next-nvidia-nvfp4",
      provider: "dgx-spark",
      effort: "high",
      prompt: "say hello",
      permissionMode: "unattended",
      requestId: "req-2",
    });
    expect(retry.requestId).not.toBe(launch.requestId);
  });

  test("keeps empty-string model/provider verbatim (harness defaults)", () => {
    const retry = buildHarnessLaunchRetry(
      { ...launch, model: "", provider: "" },
      "req-3",
    );
    expect(retry.model).toBe("");
    expect(retry.provider).toBe("");
  });
});
