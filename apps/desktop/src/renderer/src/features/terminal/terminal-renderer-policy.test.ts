// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-renderer-policy.test.ts,
// narrowed to the Drogon subset (no agent-compatibility evidence).
import { describe, expect, it } from "vitest";
import { resolvePaneRendererPolicy } from "./terminal-renderer-policy";

describe("resolvePaneRendererPolicy", () => {
  it("enables GPU by default (auto with no vetoes)", () => {
    expect(resolvePaneRendererPolicy({})).toEqual({
      gpuEnabled: true,
      reason: "capability",
    });
  });

  it("honors an explicit user off", () => {
    expect(resolvePaneRendererPolicy({ userGpuMode: "off" })).toEqual({
      gpuEnabled: false,
      reason: "user-setting",
    });
  });

  it("honors an explicit user on", () => {
    expect(resolvePaneRendererPolicy({ userGpuMode: "on" })).toEqual({
      gpuEnabled: true,
      reason: "user-setting",
    });
  });

  it("forces canvas when WebGL is unavailable", () => {
    expect(
      resolvePaneRendererPolicy({ webglUnavailable: true }),
    ).toEqual({ gpuEnabled: false, reason: "capability" });
  });

  it("forces canvas inside context-loss containment", () => {
    expect(
      resolvePaneRendererPolicy({
        userGpuMode: "on",
        inContextLossContainment: true,
      }),
    ).toEqual({ gpuEnabled: false, reason: "context-loss" });
  });

  it("keeps off stronger than containment state", () => {
    expect(
      resolvePaneRendererPolicy({
        userGpuMode: "off",
        inContextLossContainment: true,
      }),
    ).toEqual({ gpuEnabled: false, reason: "user-setting" });
  });
});
