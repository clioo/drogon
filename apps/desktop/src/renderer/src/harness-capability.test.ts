import { describe, expect, test } from "vitest";
import { supportsHarnessLaunch } from "./harness-capability";

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
