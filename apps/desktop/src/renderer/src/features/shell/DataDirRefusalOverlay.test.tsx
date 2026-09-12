// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DataDirRefusalOverlay,
  readDataDirRefusalFromLocation,
  rollbackChannelFromBuildInfo,
} from "./DataDirRefusalOverlay";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

describe("readDataDirRefusalFromLocation", () => {
  it("parses a well-formed refusal param", () => {
    const refusal = {
      dataDir: "/Users/x/Library/Application Support/Drogon",
      reason:
        "bots schema version 4 is newer than the 3 this build supports (data dir: /Users/x/Library/Application Support/Drogon)",
    };
    expect(
      readDataDirRefusalFromLocation(
        `?dataDirRefusal=${encodeURIComponent(JSON.stringify(refusal))}`,
      ),
    ).toEqual(refusal);
  });

  it("returns null when the param is absent or malformed", () => {
    expect(readDataDirRefusalFromLocation("")).toBeNull();
    expect(readDataDirRefusalFromLocation("?dataDirRefusal=%22")).toBeNull();
    expect(readDataDirRefusalFromLocation("?dataDirRefusal=%7B%7D")).toBeNull();
  });
});

describe("DataDirRefusalOverlay", () => {
  beforeEach(() => cleanup());
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "drogon");
  });
  it("renders an alertdialog naming the data dir and the refusal", () => {
    render(
      <DataDirRefusalOverlay
        refusal={{
          dataDir: "/tmp/Drogon",
          reason:
            "bots schema version 4 is newer than the 3 this build supports (data dir: /tmp/Drogon)",
        }}
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.getAttribute("aria-labelledby")).toBe(
      "datadir-refusal-title",
    );
    expect(screen.getByText(/bots schema version 4 is newer/)).toBeTruthy();
    expect(screen.getAllByText(/\/tmp\/Drogon/).length).toBeGreaterThan(0);
    expect(screen.getByText("Quit Drogon")).toBeTruthy();
  });

  // Install-resilience P6: the restore control is part of the refusal
  // surface. Without a backups bridge (an older preload) the control
  // degrades to the honest manual CLI hint — never a dead button.
  it("selects the Homebrew rollback copy for a release build", async () => {
    Object.defineProperty(window, "drogon", {
      configurable: true,
      value: {
        buildInfo: async () => ({
          revision: "abc123",
          builtAt: "2026-01-01T00:00:00Z",
          version: "0.1.0-rc.1",
          channel: "release",
        }),
      },
    });
    render(
      <DataDirRefusalOverlay
        refusal={{ dataDir: "/tmp/Drogon", reason: "newer schema" }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/brew reinstall --cask drogon/)).toBeTruthy(),
    );
    expect(screen.getByText(/previous cask version/)).toBeTruthy();
  });

  it("maps only release build-info to Homebrew", () => {
    expect(rollbackChannelFromBuildInfo({ channel: "release" })).toBe(
      "homebrew",
    );
    expect(rollbackChannelFromBuildInfo({ channel: "preview" })).toBe("manual");
    expect(rollbackChannelFromBuildInfo(null)).toBe("manual");
  });

  it("offers the pre-migration restore control with the manual fallback", () => {
    render(
      <DataDirRefusalOverlay
        refusal={{
          dataDir: "/tmp/Drogon",
          reason:
            "bots schema version 4 is newer than the 3 this build supports",
        }}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Restore a pre-migration backup" }),
    ).toBeTruthy();
    expect(screen.getByText(/drogon-cli backups list/)).toBeTruthy();
    expect(
      screen.getByText(/restore one of the pre-migration backups below/),
    ).toBeTruthy();
  });
});
