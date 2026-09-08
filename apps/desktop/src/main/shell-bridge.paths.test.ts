import { describe, expect, test } from "vitest";
import { shellBridgeSchemas } from "./shell-bridge";

describe("shell bridge admission", () => {
  test("accepts absolute worktree paths for reveal and open", () => {
    expect(
      shellBridgeSchemas.showItemInFolder.safeParse({ path: "/repo/feature" })
        .success,
    ).toBe(true);
    expect(
      shellBridgeSchemas.openPath.safeParse({ path: "/repo/feature" }).success,
    ).toBe(true);
  });

  test("rejects empty, NUL and missing paths before reaching Electron shell", () => {
    for (const path of ["", "has\0nul"]) {
      expect(
        shellBridgeSchemas.showItemInFolder.safeParse({ path }).success,
      ).toBe(false);
      expect(shellBridgeSchemas.openPath.safeParse({ path }).success).toBe(
        false,
      );
    }
    expect(shellBridgeSchemas.showItemInFolder.safeParse({}).success).toBe(
      false,
    );
  });
});
