// MIT Copyright (c) 2026 Lovecast Inc.
// Test cases ported from Orca's
// src/renderer/src/components/browser-pane/navigate/browser-notices.test.ts
// (adapted to the local module's API). The permission, popup, download and
// recovery wording under test keeps the reference wording of fork
// navigate/browser-notices.ts, browser-client-hosted-download-notices.ts
// and browser-download-destination-toast.ts.
import { describe, expect, test } from "vitest";
import {
  formatByteCount,
  formatDownloadFinishedNotice,
  formatDownloadProgressNotice,
  formatDownloadStartedNotice,
  formatLoadFailureRecoveryHint,
  formatPermissionNotice,
  formatPopupNotice,
  formatRemoteDownloadSavedMessage,
} from "./browser-notices";

describe("browser permission notice copy", () => {
  test("denied permissions name the origin and the humanized right", () => {
    expect(
      formatPermissionNotice({ origin: "https://example.com", permission: "media" }),
    ).toBe("https://example.com asked for camera or microphone access, and Drogon denied it.");
    expect(formatPermissionNotice({ origin: "unknown", permission: "geolocation" })).toBe(
      "this page asked for your location, and Drogon denied it.",
    );
  });

  test("storage permissions read as words, never raw tokens", () => {
    expect(
      formatPermissionNotice({
        origin: "https://example.com",
        permission: "top-level-storage-access",
      }),
    ).toBe(
      "https://example.com asked for cookie access on behalf of an embedded site, and Drogon denied it.",
    );
  });

  test("unknown future permissions fall back to the raw name", () => {
    expect(
      formatPermissionNotice({
        origin: "https://example.com",
        permission: "some-future-permission",
      }),
    ).toBe("https://example.com asked for some-future-permission, and Drogon denied it.");
  });
});

describe("browser popup notice copy", () => {
  test("each popup outcome says where the page went", () => {
    expect(
      formatPopupNotice({ origin: "https://example.com", action: "opened-in-drogon" }),
    ).toBe("https://example.com opened a new page in Drogon.");
    expect(
      formatPopupNotice({ origin: "https://example.com", action: "opened-external" }),
    ).toBe("https://example.com opened a new window in your default browser.");
    expect(formatPopupNotice({ origin: "unknown", action: "blocked" })).toBe(
      "A site tried to open a popup Drogon does not support here.",
    );
  });
});

describe("browser download notice copy", () => {
  test("completion names the save path; failure and cancel keep their lines", () => {
    expect(
      formatDownloadFinishedNotice({
        status: "completed",
        savePath: "/tmp/report.csv",
        error: null,
      }),
    ).toBe("Downloaded to /tmp/report.csv.");
    expect(
      formatDownloadFinishedNotice({ status: "completed", savePath: null, error: null }),
    ).toBe("Download complete.");
    expect(
      formatDownloadFinishedNotice({
        status: "failed",
        savePath: null,
        error: "Download failed.",
      }),
    ).toBe("Download failed.");
    expect(
      formatDownloadFinishedNotice({ status: "canceled", savePath: null, error: null }),
    ).toBe("Download canceled.");
  });

  test("started and progress lines match the guest progress copy", () => {
    expect(formatDownloadStartedNotice("report.pdf")).toBe("Downloading report.pdf…");
    expect(formatDownloadProgressNotice("report.pdf", 2.1 * 1024 * 1024, 8 * 1024 * 1024)).toBe(
      "Downloading report.pdf… 2.1 MB / 8.0 MB",
    );
    expect(formatDownloadProgressNotice("report.pdf", null, null)).toBe(
      "Downloading report.pdf…",
    );
  });

  test("remote saves name the workspace path and host", () => {
    expect(formatRemoteDownloadSavedMessage("ws/downloads/a.zip", "devbox")).toBe(
      "Saved to ws/downloads/a.zip on devbox",
    );
  });

  test("byte counts use the reference units", () => {
    expect(formatByteCount(512)).toBe("512 B");
    expect(formatByteCount(1024)).toBe("1.0 KB");
    expect(formatByteCount(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatByteCount(null)).toBeNull();
    expect(formatByteCount(-1)).toBeNull();
  });
});

describe("browser recovery hint copy", () => {
  test("localhost failures advise checking the local server; remote pages get no hint", () => {
    expect(formatLoadFailureRecoveryHint(true)).toBe(
      "If this should be a local app, make sure the server is running and listening on the expected port.",
    );
    expect(formatLoadFailureRecoveryHint(false)).toBeNull();
  });
});
