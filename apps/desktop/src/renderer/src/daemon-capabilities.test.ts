// @vitest-environment node
// User-feature-closure item 7: a mixed-version old daemon must never be
// silently treated as fully capable. These are pure functions -- no
// bootstrap/spawn/restart decision lives here (see the module doc).

import { describe, expect, it } from "vitest";
import { BOTS_CAPABILITY } from "./bots-mount";
import {
  AGENT_SETTINGS_CAPABILITY,
  isAgentSettingsAvailable,
  isMixedVersionDaemon,
  missingRequiredCapabilities,
  REQUIRED_DAEMON_CAPABILITIES,
} from "./daemon-capabilities";

describe("isAgentSettingsAvailable", () => {
  it("is false for an old daemon's empty capability list", () => {
    expect(isAgentSettingsAvailable([])).toBe(false);
  });

  it("is true once the daemon advertises agent.settings.v1", () => {
    expect(isAgentSettingsAvailable([AGENT_SETTINGS_CAPABILITY])).toBe(true);
  });

  it("is unaffected by unrelated capabilities", () => {
    expect(isAgentSettingsAvailable(["workspace.v1", "git.v1"])).toBe(false);
  });
});

describe("missingRequiredCapabilities", () => {
  it("reports both gaps for a pre-Bots, pre-Agent-Settings daemon", () => {
    expect(missingRequiredCapabilities([])).toEqual([
      AGENT_SETTINGS_CAPABILITY,
      BOTS_CAPABILITY,
    ]);
  });

  it("reports only the still-missing capability", () => {
    expect(missingRequiredCapabilities([BOTS_CAPABILITY])).toEqual([
      AGENT_SETTINGS_CAPABILITY,
    ]);
    expect(
      missingRequiredCapabilities([AGENT_SETTINGS_CAPABILITY]),
    ).toEqual([BOTS_CAPABILITY]);
  });

  it("is empty once every required capability is advertised", () => {
    expect(
      missingRequiredCapabilities([
        ...REQUIRED_DAEMON_CAPABILITIES,
        "workspace.v1",
      ]),
    ).toEqual([]);
  });
});

describe("isMixedVersionDaemon", () => {
  it("flags an old daemon (dc12c7a-era: neither capability) as mixed-version", () => {
    expect(isMixedVersionDaemon([])).toBe(true);
  });

  it("does not flag a fully current daemon", () => {
    expect(isMixedVersionDaemon([...REQUIRED_DAEMON_CAPABILITIES])).toBe(
      false,
    );
  });
});
