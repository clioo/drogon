import { describe, expect, test } from "vitest";
import {
  isHarnessLaunchable,
  supportsHarnessCatalog,
  supportsHarnessLaunch,
} from "./harness-capability";

describe("harness capability gating", () => {
  test("requires both catalog and launch capabilities", () => {
    expect(
      supportsHarnessLaunch(["harness.catalog.v1", "harness.launch.v1"]),
    ).toBe(true);
    expect(
      supportsHarnessLaunch([
        "harness.catalog.v1",
        "harness.launch.v1",
        "extra",
      ]),
    ).toBe(true);
  });
  test("an older service missing either capability is treated as unsupported", () => {
    expect(supportsHarnessLaunch(["harness.catalog.v1"])).toBe(false);
    expect(supportsHarnessLaunch(["harness.launch.v1"])).toBe(false);
    expect(supportsHarnessLaunch([])).toBe(false);
    expect(supportsHarnessLaunch(["session.pty.v1"])).toBe(false);
  });
});

describe("harness catalog capability and launch fencing (C01 adapters)", () => {
  test("catalog capability is probed independently of launch", () => {
    expect(
      supportsHarnessCatalog(["harness.catalog.v1", "harness.launch.v1"]),
    ).toBe(true);
    expect(supportsHarnessCatalog(["harness.launch.v1"])).toBe(false);
    expect(supportsHarnessCatalog([])).toBe(false);
  });
  test("only available harnesses are launchable", () => {
    expect(isHarnessLaunchable({ availability: "available" })).toBe(true);
    expect(isHarnessLaunchable({ availability: "missing" })).toBe(false);
    expect(isHarnessLaunchable({ availability: "unsupported_launcher" })).toBe(
      false,
    );
  });
});
