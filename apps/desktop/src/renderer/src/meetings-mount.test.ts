// MIT Copyright (c) 2026 Lovecast Inc.
// Meetings mount: the route id, the capability gate and the window lookup.
// The gate is what keeps an older service from looking like "no meetings",
// so every one of these assertions is about a refusal staying a refusal.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEETINGS_ACTIONS_CAPABILITY,
  MEETINGS_CAPABILITY,
  MEETINGS_PAGE_HOST_TESTID,
  MEETINGS_ROUTE_ID,
  createGatedMeetingsBridge,
  isMeetingsActionsAvailable,
  isMeetingsAvailable,
  windowMeetingsBridge,
} from "./meetings-mount";
import type { MeetingsBridge } from "../../shared/meetings-contract";
import {
  NOTE_ID,
  availability,
  bridgeFor,
  commitment,
  commitmentPage,
  page,
  transcript,
} from "./features/meetings/meetings-test-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

const pageResult = {
  ok: true as const,
  result: page({
    availability: availability({
      reason: "empty",
      configuration: "defaults",
      configured: false,
      configPresent: false,
      transcriptRoot: "/Users/meetings-fixture/Transcripts",
      transcriptRootSource: "default",
    }),
    meetings: [],
    total: 0,
  }),
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

  it("gates the working half on its own capability", () => {
    // An index-only service still lists and searches; it simply does not get
    // the extraction and the ledger.
    expect(isMeetingsActionsAvailable(["meetings.v1", "meetings.actions.v1"])).toBe(true);
    expect(isMeetingsActionsAvailable(["meetings.v1"])).toBe(false);
    expect(isMeetingsActionsAvailable([])).toBe(false);
    expect(MEETINGS_ACTIONS_CAPABILITY).toBe("meetings.actions.v1");
  });

  it("finds the granted namespace or reports none", () => {
    vi.stubGlobal("window", {
      drogon: { meetings: { list: () => {}, read: () => {} } },
    });
    expect(windowMeetingsBridge()).toBeTruthy();
    vi.stubGlobal("window", { drogon: {} });
    expect(windowMeetingsBridge()).toBeNull();
    vi.stubGlobal("window", {});
    expect(windowMeetingsBridge()).toBeNull();
  });

  it("refuses every call while the capability is withheld", async () => {
    const source = bridgeFor({ list: vi.fn(async () => pageResult) });
    const gated = createGatedMeetingsBridge(source, () => false);
    const list = await gated.list();
    const read = await gated.read({ id: "write-that-down:/x/y.md" });
    const analyze = await gated.analyze({ id: NOTE_ID });
    const accepted = await gated.accept({
      meetingId: NOTE_ID,
      text: "t",
      quote: "a quote long enough",
      source: "owner",
    });
    expect(list.ok).toBe(false);
    expect(read.ok).toBe(false);
    expect(analyze.ok).toBe(false);
    expect(accepted.ok).toBe(false);
    if (!list.ok) expect(list.error.code).toBe("unsupported_capability");
    expect(source.list).not.toHaveBeenCalled();
    expect(source.read).not.toHaveBeenCalled();
    expect(source.analyze).not.toHaveBeenCalled();
    expect(source.accept).not.toHaveBeenCalled();
  });

  it("keeps the index usable when only the actions capability is withheld", async () => {
    const source = bridgeFor({ list: vi.fn(async () => pageResult) });
    const gated = createGatedMeetingsBridge(
      source,
      () => true,
      () => false,
    );
    expect((await gated.list()).ok).toBe(true);
    const analyze = await gated.analyze({ id: NOTE_ID });
    const accept = await gated.accept({
      meetingId: NOTE_ID,
      text: "t",
      quote: "a quote long enough",
      source: "owner",
    });
    expect(analyze.ok).toBe(false);
    expect(accept.ok).toBe(false);
    if (!analyze.ok) {
      expect(analyze.error.message).toContain("meetings.actions.v1");
    }
    expect(source.analyze).not.toHaveBeenCalled();
    expect(source.accept).not.toHaveBeenCalled();
  });

  it("passes calls through and fails closed the moment the capability drops", async () => {
    let allowed = true;
    const source = bridgeFor({
      list: vi.fn(async () => pageResult),
      read: vi.fn(async () => ({
        ok: true as const,
        result: {
          meeting: transcript({
            id: "write-that-down:/x/y.md",
            filePath: "/x/y.md",
            relativePath: "2026-09-10/y.md",
            startedAt: null,
            durationMinutes: null,
            status: "recording",
            excerpt: "",
          }),
          content: "x",
          size: 1,
          truncated: false,
        },
      })),
      commitments: vi.fn(async () => ({ ok: true as const, result: commitmentPage() })),
    });
    const gated = createGatedMeetingsBridge(source, () => allowed);
    expect((await gated.list()).ok).toBe(true);
    expect((await gated.commitments()).ok).toBe(true);
    allowed = false;
    expect((await gated.list()).ok).toBe(false);
    expect((await gated.read({ id: "write-that-down:/x/y.md" })).ok).toBe(false);
    expect((await gated.resolve({ id: "commitment-1", status: "done" })).ok).toBe(false);
    // Only the calls made while it was allowed reached the source.
    expect(source.list).toHaveBeenCalledTimes(1);
    expect(source.commitments).toHaveBeenCalledTimes(1);
    expect(source.read).not.toHaveBeenCalled();
    expect(source.resolve).not.toHaveBeenCalled();
  });
});
