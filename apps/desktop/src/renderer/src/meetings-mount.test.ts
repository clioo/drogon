// MIT Copyright (c) 2026 Lovecast Inc.
// Meetings mount: the route id, the capability gate and the window lookup.
// The gate is what keeps an older service from looking like "no meetings",
// so every one of these assertions is about a refusal staying a refusal.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEETINGS_CAPABILITY,
  MEETINGS_PAGE_HOST_TESTID,
  MEETINGS_ROUTE_ID,
  createGatedMeetingsBridge,
  isMeetingsAvailable,
  windowMeetingsBridge,
} from "./meetings-mount";
import type { MeetingsBridge } from "../../shared/meetings-contract";

afterEach(() => {
  vi.unstubAllGlobals();
});

const pageResult = {
  ok: true as const,
  result: {
    availability: {
      status: "available" as const,
      reason: "empty" as const,
      platform: "macos",
      supported: true,
      installation: "installed" as const,
      configuration: "defaults" as const,
      configured: false,
      configPath: "/Users/meetings-fixture/Library/Application Support/WriteThatDown/config.json",
      configPresent: false,
      transcriptRoot: "/Users/meetings-fixture/Transcripts",
      transcriptRootSource: "default" as const,
      transcriptRootState: "readable" as const,
      readOnly: true,
    },
    meetings: [],
    total: 0,
    offset: 0,
    limit: 50,
    hasMore: false,
    scanTruncated: false,
  },
};

describe("meetings mount", () => {
  it("owns the meetings route id and its stable host test id", () => {
    expect(MEETINGS_ROUTE_ID).toBe("meetings");
    expect(MEETINGS_PAGE_HOST_TESTID).toBe("meetings-page-host");
    expect(MEETINGS_CAPABILITY).toBe("meetings.v1");
  });

  it("is available exactly when the service advertises meetings.v1", () => {
    expect(isMeetingsAvailable(["workspace.v1", "meetings.v1"])).toBe(true);
    expect(isMeetingsAvailable(["workspace.v1"])).toBe(false);
    expect(isMeetingsAvailable([])).toBe(false);
  });

  it("finds the granted namespace or reports none", () => {
    vi.stubGlobal("window", { drogon: { meetings: { list: () => {}, read: () => {} } } });
    expect(windowMeetingsBridge()).toBeTruthy();
    vi.stubGlobal("window", { drogon: {} });
    expect(windowMeetingsBridge()).toBeNull();
    vi.stubGlobal("window", {});
    expect(windowMeetingsBridge()).toBeNull();
  });

  it("refuses every call while the capability is withheld", async () => {
    const source: MeetingsBridge = {
      list: vi.fn(async () => pageResult),
      read: vi.fn(async () => ({ ok: false as const, error: { code: "x", message: "y", retryable: false } })),
    };
    const gated = createGatedMeetingsBridge(source, () => false);
    const list = await gated.list();
    const read = await gated.read({ id: "write-that-down:/x/y.md" });
    expect(list.ok).toBe(false);
    expect(read.ok).toBe(false);
    if (!list.ok) expect(list.error.code).toBe("unsupported_capability");
    expect(source.list).not.toHaveBeenCalled();
    expect(source.read).not.toHaveBeenCalled();
  });

  it("passes calls through and fails closed the moment the capability drops", async () => {
    let allowed = true;
    const source: MeetingsBridge = {
      list: vi.fn(async () => pageResult),
      read: vi.fn(async () => ({
        ok: true as const,
        result: {
          meeting: {
            id: "write-that-down:/x/y.md",
            title: "t",
            fileName: "y.md",
            filePath: "/x/y.md",
            relativePath: "2026-09-10/y.md",
            dateFolder: "2026-09-10",
            startedAt: null,
            durationMinutes: null,
            status: "recording" as const,
            excerpt: "",
            failureReason: null,
          },
          content: "x",
          size: 1,
          truncated: false,
        },
      })),
    };
    const gated = createGatedMeetingsBridge(source, () => allowed);
    expect((await gated.list()).ok).toBe(true);
    allowed = false;
    expect((await gated.list()).ok).toBe(false);
    expect((await gated.read({ id: "write-that-down:/x/y.md" })).ok).toBe(false);
    // Only the first call reached the source.
    expect(source.list).toHaveBeenCalledTimes(1);
    expect(source.read).not.toHaveBeenCalled();
  });
});
