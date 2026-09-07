// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-renderer-policy.ts.
// Adapted: the source also gates on agent-compatibility evidence (Gemini pane
// titles/owners force the DOM renderer); Drogon has no agent owners or GPU
// setting, so the policy keeps the user-setting/capability/context-loss
// precedence with a `mode` parameter defaulting to "auto".

export type TerminalGpuMode = "auto" | "on" | "off";

/**
 * The resolved renderer decision for a pane. `gpuEnabled` gates loading the
 * WebGL addon; the terminal always keeps its canvas/DOM fallback when WebGL
 * construction or activation fails at runtime.
 */
export type RendererPolicyDecision = {
  gpuEnabled: boolean;
  reason: "user-setting" | "capability" | "context-loss";
};

export type ResolvePaneRendererPolicyInput = {
  userGpuMode?: TerminalGpuMode;
  /** Set when the pane cannot obtain a WebGL context at all. */
  webglUnavailable?: boolean;
  /** Set when the pane is inside GPU crash/context-loss containment. */
  inContextLossContainment?: boolean;
};

/**
 * Precedence: user `off` forces the canvas renderer; WebGL
 * unavailable/context-loss force canvas; explicit `on` keeps GPU; `auto`
 * enables GPU (no agent-compatibility veto exists in Drogon).
 */
export function resolvePaneRendererPolicy(
  input: ResolvePaneRendererPolicyInput,
): RendererPolicyDecision {
  const mode = input.userGpuMode ?? "auto";
  if (mode === "off") {
    return { gpuEnabled: false, reason: "user-setting" };
  }
  if (input.inContextLossContainment) {
    return { gpuEnabled: false, reason: "context-loss" };
  }
  if (input.webglUnavailable) {
    return { gpuEnabled: false, reason: "capability" };
  }
  if (mode === "on" || mode === "auto") {
    return {
      gpuEnabled: true,
      reason: mode === "on" ? "user-setting" : "capability",
    };
  }
  return { gpuEnabled: false, reason: "user-setting" };
}
