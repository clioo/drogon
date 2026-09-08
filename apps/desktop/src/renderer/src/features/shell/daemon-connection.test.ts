// State machine, backoff ladder and copy for the daemon-connection port.
// The ladder values and jitter rule are fork-verbatim
// (web-runtime-connection-transport.ts RECONNECT_DELAYS_MS,
// shared/reconnect-jitter.ts); the give-up/stable rules mirror the SSH
// ladder (main/ssh/ssh-reconnect-ladder.ts).
import { describe, expect, it } from "vitest";
import {
  DAEMON_HEARTBEAT_INTERVAL_MS,
  DAEMON_RECONNECT_BUTTON_LABEL,
  DAEMON_RECONNECT_DELAYS_MS,
  DAEMON_RECONNECTING_TITLE,
  daemonConnectionDotClass,
  daemonConnectionStatusLabel,
  daemonConnectionToneClass,
  daemonDisconnectExplanation,
  daemonDisconnectSummary,
  daemonReconnectAttemptLabel,
  daemonReconnectDelay,
  daemonReconnectingBody,
  withDaemonReconnectJitter,
} from "./daemon-connection";

describe("DAEMON_RECONNECT_DELAYS_MS", () => {
  it("matches the fork's service-reconnect ladder step for step", () => {
    expect(DAEMON_RECONNECT_DELAYS_MS).toEqual([
      500, 1000, 2000, 4000, 8000, 15000,
    ]);
  });
  it("heartbeats on the fork's connection-heartbeat cadence", () => {
    expect(DAEMON_HEARTBEAT_INTERVAL_MS).toBe(10_000);
  });
});

describe("withDaemonReconnectJitter", () => {
  it("never shortens the delay below its backoff floor", () => {
    expect(withDaemonReconnectJitter(1000, () => 0)).toBe(1000);
  });
  it("adds at most twenty percent on top", () => {
    expect(withDaemonReconnectJitter(1000, () => 0.9999)).toBeLessThan(1200);
    expect(withDaemonReconnectJitter(1000, () => 1)).toBe(1200);
  });
});

describe("daemonReconnectDelay", () => {
  it("walks the ladder step for step", () => {
    const noJitter = () => 0;
    expect(DAEMON_RECONNECT_DELAYS_MS.map((_, i) => daemonReconnectDelay(i, noJitter))).toEqual(
      DAEMON_RECONNECT_DELAYS_MS,
    );
  });
  it("pins to the last step past the end: retries never stop", () => {
    // Web-transport semantics: a service restart minutes later must still
    // reconnect on its own, so the monitor repeats the cap indefinitely
    // instead of giving up.
    const noJitter = () => 0;
    expect(daemonReconnectDelay(5, noJitter)).toBe(15000);
    expect(daemonReconnectDelay(6, noJitter)).toBe(15000);
    expect(daemonReconnectDelay(99, noJitter)).toBe(15000);
  });
});

describe("daemon connection copy", () => {
  it("labels every state like the fork's status row", () => {
    expect(daemonConnectionStatusLabel("connected")).toBe("Connected");
    expect(daemonConnectionStatusLabel("checking")).toBe("Checking");
    expect(daemonConnectionStatusLabel("reconnecting")).toBe("Reconnecting");
  });
  it("dots and tones follow the fork mapping", () => {
    expect(daemonConnectionDotClass("connected")).toBe("bg-emerald-500");
    expect(daemonConnectionDotClass("checking")).toBe("bg-yellow-500");
    expect(daemonConnectionDotClass("reconnecting")).toBe("bg-yellow-500");
    expect(daemonConnectionToneClass("reconnecting")).toBe("text-yellow-500");
    expect(daemonConnectionToneClass("connected")).toBe(
      "text-muted-foreground",
    );
  });
  it("banner copy names the Drogon service", () => {
    expect(DAEMON_RECONNECTING_TITLE).toContain("Drogon");
    expect(daemonReconnectingBody("app")).toContain("retrying automatically");
    expect(daemonReconnectingBody("terminal")).toContain("This terminal");
    expect(DAEMON_RECONNECT_BUTTON_LABEL).toBe("Reconnect");
  });
  it("the failure copy never claims the sessions are gone", () => {
    expect(daemonDisconnectSummary("reconnecting")).toContain(
      "trying to restore",
    );
    expect(daemonDisconnectExplanation("reconnecting")).toContain(
      "may still be running",
    );
    expect(daemonDisconnectExplanation("connected")).toBeNull();
  });
  it("numbers reconnect attempts from one", () => {
    expect(daemonReconnectAttemptLabel(0)).toBe("Attempt 1");
  });
});
