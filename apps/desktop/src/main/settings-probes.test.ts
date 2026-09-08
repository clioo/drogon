import { describe, expect, test } from "vitest";
import {
  parseGhAuthStatus,
  parseGitConfigValue,
  probeGhAuthStatus,
  probeGitIdentity,
  type ProbeRunner,
} from "./settings-probes";
import {
  defaultHarnessIdSchema,
  ghAuthStatusResultSchema,
  gitIdentityInputSchema,
  gitIdentityResultSchema,
  harnessAgentDefaultSchema,
  harnessDefaultsSchema,
  notifyOnAgentNeedsInputSchema,
  settingsSubsetAdditionSchema,
  terminalFontSizeSchema,
  terminalGpuAccelerationSchema,
} from "../shared/settings-contract";

const okRun = (
  stdout: string,
  exitCode = 0,
  stderr = "",
): Extract<
  Awaited<ReturnType<ProbeRunner>>,
  { ok: true }
> => ({ ok: true, stdout, stderr, exitCode });

describe("parseGitConfigValue", () => {
  test("trims the configured value on exit 0", () => {
    expect(parseGitConfigValue(okRun("clioo\n"))).toBe("clioo");
  });
  test("exit 1 (unset) yields null, not an empty string", () => {
    expect(parseGitConfigValue(okRun("", 1))).toBeNull();
  });
  test("empty output on exit 0 yields null", () => {
    expect(parseGitConfigValue(okRun("\n"))).toBeNull();
  });
  test("any other exit code is unparseable", () => {
    expect(parseGitConfigValue(okRun("odd", 128, "fatal"))).toBeNull();
  });
});

describe("probeGitIdentity", () => {
  test("returns the effective name/email when git responds", async () => {
    const run: ProbeRunner = async (_file, args) =>
      okRun(args[1] === "user.name" ? "clioo\n" : "a@b.c\n");
    const result = await probeGitIdentity({ workspacePath: "/repo" }, run);
    expect(result).toEqual({
      ok: true,
      result: {
        workspacePath: "/repo",
        available: true,
        name: "clioo",
        email: "a@b.c",
        reason: null,
      },
    });
  });
  test("unset keys stay null while the probe stays available", async () => {
    const run: ProbeRunner = async () => okRun("", 1);
    const result = await probeGitIdentity({ workspacePath: "/repo" }, run);
    expect(result.ok && result.result.available).toBe(true);
    if (result.ok) {
      expect(result.result.name).toBeNull();
      expect(result.result.email).toBeNull();
    }
  });
  test("a missing git binary is unavailable with an honest reason", async () => {
    const run: ProbeRunner = async () => ({
      ok: false,
      reason: "not-installed",
    });
    const result = await probeGitIdentity({ workspacePath: "/repo" }, run);
    expect(result).toEqual({
      ok: true,
      result: {
        workspacePath: "/repo",
        available: false,
        name: null,
        email: null,
        reason: "git is not installed or not on PATH",
      },
    });
  });
  test("rejects a NUL byte in the workspace path without spawning", async () => {
    let spawned = false;
    const run: ProbeRunner = async () => {
      spawned = true;
      return okRun("");
    };
    const result = await probeGitIdentity({ workspacePath: "a\0b" }, run);
    expect(result.ok).toBe(false);
    expect(spawned).toBe(false);
  });
});

describe("parseGhAuthStatus", () => {
  test("exit 0 means logged in and keeps the output", () => {
    const parsed = parseGhAuthStatus(
      okRun("github.com\n  ✓ Logged in\n", 0),
    );
    expect(parsed.loggedIn).toBe(true);
    expect(parsed.output).toContain("Logged in");
  });
  test("a nonzero exit keeps gh's explanation and means logged out", () => {
    const parsed = parseGhAuthStatus(
      okRun("", 1, "You are not logged into any GitHub hosts."),
    );
    expect(parsed.loggedIn).toBe(false);
    expect(parsed.output).toContain("not logged in");
  });
  test("empty output degrades to a placeholder, never an empty string", () => {
    expect(parseGhAuthStatus(okRun("", 1)).output).toBe("(no output)");
  });
  test("long output is truncated", () => {
    const parsed = parseGhAuthStatus(okRun("x".repeat(5000), 0));
    expect(parsed.output.length).toBeLessThanOrEqual(2049);
  });
});

describe("probeGhAuthStatus", () => {
  test("a missing gh binary is unavailable, never logged-out", async () => {
    const run: ProbeRunner = async () => ({
      ok: false,
      reason: "not-installed",
    });
    expect(await probeGhAuthStatus(run)).toEqual({
      ok: true,
      result: {
        available: false,
        loggedIn: false,
        output: "gh is not installed or not on PATH",
      },
    });
  });
});

describe("settings-contract validation", () => {
  test("terminal font size accepts the 9..32 band only", () => {
    expect(terminalFontSizeSchema.safeParse(13).success).toBe(true);
    expect(terminalFontSizeSchema.safeParse(8).success).toBe(false);
    expect(terminalFontSizeSchema.safeParse(33).success).toBe(false);
    expect(terminalFontSizeSchema.safeParse(13.5).success).toBe(false);
  });
  test("default harness id is free text without control characters", () => {
    expect(defaultHarnessIdSchema.safeParse("pi").success).toBe(true);
    expect(defaultHarnessIdSchema.safeParse("").success).toBe(true);
    expect(defaultHarnessIdSchema.safeParse("a\0b").success).toBe(false);
  });
  test("per-harness defaults allow empty model/effort but reject NUL and bad modes", () => {
    expect(
      harnessAgentDefaultSchema.safeParse({
        model: "",
        effort: "",
        permissionMode: "inherit",
      }).success,
    ).toBe(true);
    expect(
      harnessAgentDefaultSchema.safeParse({
        model: "a\0b",
        effort: "",
        permissionMode: "inherit",
      }).success,
    ).toBe(false);
    expect(
      harnessAgentDefaultSchema.safeParse({
        model: "",
        effort: "",
        permissionMode: "sudo",
      }).success,
    ).toBe(false);
  });
  test("harness defaults map caps entries and validates each value", () => {
    expect(
      harnessDefaultsSchema.safeParse({
        pi: { model: "opus", effort: "high", permissionMode: "unattended" },
      }).success,
    ).toBe(true);
    expect(
      harnessDefaultsSchema.safeParse({
        pi: { model: "opus", effort: "high" },
      }).success,
    ).toBe(false);
    expect(notifyOnAgentNeedsInputSchema.safeParse(false).success).toBe(true);
    expect(notifyOnAgentNeedsInputSchema.safeParse("yes").success).toBe(false);
  });
  test("the J10 addition shape accepts a full valid value", () => {
    expect(
      settingsSubsetAdditionSchema.safeParse({
        terminalFontSize: 14,
        defaultHarnessId: "claude",
        harnessDefaults: {},
        notifyOnAgentNeedsInput: true,
        terminalGpuAcceleration: "auto",
      }).success,
    ).toBe(true);
  });
  test("the GPU acceleration mode vocabulary is exactly the source's", () => {
    expect(terminalGpuAccelerationSchema.safeParse("off").success).toBe(true);
    expect(terminalGpuAccelerationSchema.safeParse("always").success).toBe(false);
  });
  test("probe schemas reject oversized or mistyped payloads", () => {
    expect(gitIdentityInputSchema.safeParse({ workspacePath: "" }).success).toBe(
      false,
    );
    expect(
      gitIdentityResultSchema.safeParse({
        workspacePath: "/r",
        available: true,
        name: "n",
        email: null,
        reason: null,
      }).success,
    ).toBe(true);
    expect(
      ghAuthStatusResultSchema.safeParse({
        available: true,
        loggedIn: true,
        output: "ok",
      }).success,
    ).toBe(true);
    expect(
      ghAuthStatusResultSchema.safeParse({
        available: true,
        loggedIn: "yes",
        output: "ok",
      }).success,
    ).toBe(false);
  });
});
