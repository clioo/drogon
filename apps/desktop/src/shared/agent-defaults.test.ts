import { describe, expect, test } from "vitest";
import {
  buildImmediateHarnessLaunch,
  DEFAULT_HARNESS_PERMISSION_MODES,
  resolveHarnessAgentDefault,
  resolveHarnessPermissionMode,
  splitPiProviderModel,
} from "./agent-defaults";

describe("fork default permission modes (#231)", () => {
  test("Claude Code, Antigravity, and Codex launch unattended", () => {
    expect(DEFAULT_HARNESS_PERMISSION_MODES).toEqual({
      claude: "unattended",
      antigravity: "unattended",
      codex: "unattended",
      pi: "inherit",
      opencode: "inherit",
    });
  });

  test("an absent entry resolves to the fork default, a stored one wins", () => {
    expect(resolveHarnessAgentDefault("claude", {})).toEqual({
      model: "",
      effort: "",
      permissionMode: "unattended",
    });
    expect(
      resolveHarnessPermissionMode("claude", {
        claude: { model: "", effort: "", permissionMode: "inherit" },
      }),
    ).toBe("inherit");
    expect(
      resolveHarnessPermissionMode("pi", {
        pi: { model: "", effort: "", permissionMode: "unattended" },
      }),
    ).toBe("unattended");
  });
});

describe("splitPiProviderModel", () => {
  test("a provider/model-id shorthand splits; a bare id rides alone", () => {
    expect(splitPiProviderModel("dgx-spark/qwen3.8-flash-next-nvidia-nvfp4")).toEqual({
      provider: "dgx-spark",
      model: "qwen3.8-flash-next-nvidia-nvfp4",
    });
    expect(splitPiProviderModel("qwen3.8-flash-next")).toEqual({
      model: "qwen3.8-flash-next",
    });
    expect(splitPiProviderModel("  ")).toEqual({});
    expect(splitPiProviderModel("/trailing")).toEqual({ model: "/trailing" });
  });
});

describe("buildImmediateHarnessLaunch", () => {
  test("a Pi row splits the stored provider/model id into both flags", () => {
    expect(
      buildImmediateHarnessLaunch("ws", "pi", {
        pi: {
          model: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
          effort: "",
          permissionMode: "unattended",
        },
      }),
    ).toEqual({
      workspaceId: "ws",
      harnessId: "pi",
      model: "qwen3.8-flash-next-nvidia-nvfp4",
      provider: "dgx-spark",
      effort: undefined,
      prompt: undefined,
      permissionMode: "unattended",
    });
  });

  test("blank fields reach the service as absent keys, never empty strings", () => {
    expect(buildImmediateHarnessLaunch("ws", "claude", {})).toEqual({
      workspaceId: "ws",
      harnessId: "claude",
      model: undefined,
      effort: undefined,
      prompt: undefined,
      permissionMode: "unattended",
    });
  });

  test("Codex rows use the unattended bypass default", () => {
    expect(buildImmediateHarnessLaunch("ws", "codex", {})).toMatchObject({
      harnessId: "codex",
      permissionMode: "unattended",
    });
  });

  test("stored effort applies to every harness", () => {
    const launch = buildImmediateHarnessLaunch("ws", "pi", {
      pi: { model: "", effort: "high", permissionMode: "inherit" },
    });
    expect(launch.effort).toBe("high");
    expect(launch.permissionMode).toBe("inherit");
  });
});
