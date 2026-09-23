// MIT Copyright (c) 2026 Lovecast Inc.
// Install-resilience P4: the general daemon-skew policy — wire-behavior
// feature floors mirroring the Orca reference
// `src/main/daemon/daemon-protocol-version.ts`, and the classifier that
// separates "the daemon is older than this request" (direct to a service
// restart) from "this build sent something malformed" (verbatim error).
import { describe, expect, test, vi } from "vitest";
import {
  BOT_RUN_INTERACTIVE_FIELD_PROTOCOL,
  daemonSkewRefusalMessage,
  daemonSupportsFeatureProtocol,
  isAgentSettingsAvailable,
  isDaemonSkewError,
  isMixedVersionDaemon,
  missingRequiredCapabilities,
  shouldGateLaunchOnAgentSettingsReadiness,
} from "./daemon-capabilities";

describe("regression: the two-capability gates are unchanged", () => {
  test("required-capability helpers keep their contract", () => {
    expect(missingRequiredCapabilities([])).toEqual([
      "agent.settings.v1",
      "bot.snapshot.v1",
    ]);
    expect(isMixedVersionDaemon(["agent.settings.v1", "bot.snapshot.v1"])).toBe(
      false,
    );
    expect(isMixedVersionDaemon([])).toBe(true);
    expect(isAgentSettingsAvailable(["agent.settings.v1"])).toBe(true);
    expect(shouldGateLaunchOnAgentSettingsReadiness(true, [])).toBe(false);
    expect(shouldGateLaunchOnAgentSettingsReadiness(false, [])).toBe(true);
  });
});

describe("daemonSupportsFeatureProtocol (live feature detection)", () => {
  test("a floor at or below the reported version is supported", () => {
    expect(daemonSupportsFeatureProtocol(2, BOT_RUN_INTERACTIVE_FIELD_PROTOCOL)).toBe(
      true,
    );
    expect(daemonSupportsFeatureProtocol(3, BOT_RUN_INTERACTIVE_FIELD_PROTOCOL)).toBe(
      true,
    );
  });
  test("below the floor is unsupported", () => {
    expect(daemonSupportsFeatureProtocol(1, BOT_RUN_INTERACTIVE_FIELD_PROTOCOL)).toBe(
      false,
    );
  });
  test("unknown (null/undefined — daemon predates reporting) never claims support", () => {
    expect(daemonSupportsFeatureProtocol(null, BOT_RUN_INTERACTIVE_FIELD_PROTOCOL)).toBe(
      false,
    );
    expect(
      daemonSupportsFeatureProtocol(undefined, BOT_RUN_INTERACTIVE_FIELD_PROTOCOL),
    ).toBe(false);
  });
});

describe("isDaemonSkewError: skew vs malformed request", () => {
  test("the audit's exact refusal classifies as skew", () => {
    expect(
      isDaemonSkewError({
        code: "invalid_argument",
        message: "unknown field interactive",
      }),
    ).toBe(true);
  });
  test("serde's deny_unknown_fields shape classifies as skew", () => {
    expect(
      isDaemonSkewError({
        code: "invalid_argument",
        message:
          "unknown field `futureField`, expected one of `workspaceId`, `botId` at line 1 column 42",
      }),
    ).toBe(true);
  });
  test("unknown variant (enum skew) classifies as skew", () => {
    expect(
      isDaemonSkewError({
        code: "invalid_argument",
        message: "unknown variant `newMode`, expected one of `inherit`",
      }),
    ).toBe(true);
  });
  test("unknown methods and protocol downgrades classify as skew", () => {
    expect(isDaemonSkewError({ code: "method_not_found", message: "nope" })).toBe(
      true,
    );
    expect(
      isDaemonSkewError({
        code: "unsupported_protocol",
        message: "Unsupported protocol version.",
      }),
    ).toBe(true);
  });
  test("genuine malformed requests are NOT skew", () => {
    expect(
      isDaemonSkewError({
        code: "invalid_argument",
        message: "bot.run params must be an object",
      }),
    ).toBe(false);
    expect(
      isDaemonSkewError({
        code: "invalid_argument",
        message: "botId must not be empty",
      }),
    ).toBe(false);
    expect(
      isDaemonSkewError({
        code: "invalid_argument",
        message: "Invalid request envelope.",
      }),
    ).toBe(false);
  });
  test("domain refusals are not skew", () => {
    expect(
      isDaemonSkewError({
        code: "runtime_busy",
        message: "one or more sessions are pending, live or unverifiable",
      }),
    ).toBe(false);
  });
});

describe("regression: REQUIRED_DAEMON_CAPABILITIES survives the bots-first entry order", () => {
  test("importing the Bots panel graph before daemon-capabilities keeps the list complete", async () => {
    // BOTS_CAPABILITY used to live in bots-mount.ts, closing a product
    // import cycle (daemon-capabilities → bots-mount →
    // bots-panel-descriptor → BotsPanel → use-bots-page-controller →
    // bot-session-open → daemon-capabilities) in which
    // REQUIRED_DAEMON_CAPABILITIES read BOTS_CAPABILITY at
    // module-evaluation time. Entering the cycle anywhere but
    // daemon-capabilities itself froze `undefined` into the shared array.
    // Forcing that previously poisonous order here pins the root fix
    // (the leaf bots-capability.ts): delete the leaf or re-close the
    // cycle and this test goes red.
    vi.resetModules();
    await import("./bots-mount");
    const { REQUIRED_DAEMON_CAPABILITIES } = await import("./daemon-capabilities");
    expect(REQUIRED_DAEMON_CAPABILITIES).toEqual([
      "agent.settings.v1",
      "bot.snapshot.v1",
    ]);
    expect(REQUIRED_DAEMON_CAPABILITIES).not.toContain(undefined);
    // The leaf exists so daemon-capabilities never enters the Bots panel
    // graph; bots-mount keeps its own module-local declaration, so the two
    // copies must agree — otherwise one gate would check a capability the
    // service never advertises.
    const leaf = await import("./bots-capability");
    const mount = await import("./bots-mount");
    expect(leaf.BOTS_CAPABILITY).toBe("bot.snapshot.v1");
    expect(mount.BOTS_CAPABILITY).toBe(leaf.BOTS_CAPABILITY);
  });
});

describe("daemonSkewRefusalMessage: restart-directed copy, never serde text", () => {
  test("a skew refusal is rewritten to the restart affordance copy", () => {
    const message = daemonSkewRefusalMessage({
      code: "invalid_argument",
      message: "unknown field interactive",
    });
    expect(message).toContain("newer than its background service");
    expect(message).toContain("Restart Drogon's service");
    expect(message).not.toContain("interactive");
  });
  test("non-skew errors pass through untouched (null)", () => {
    expect(
      daemonSkewRefusalMessage({
        code: "invalid_argument",
        message: "bot.run params must be an object",
      }),
    ).toBeNull();
  });
});
