// MIT Copyright (c) 2026 Lovecast Inc.
// Meetings bridge: the renderer's only door to the notes index. These tests
// pin the three things the honest states depend on — only the documented
// operations reach the daemon, a malformed daemon answer is refused instead
// of rendered, and a daemon refusal is passed through unchanged.
import { describe, expect, it, vi } from "vitest";
import { dispatchMeetingsRequest } from "./meetings-bridge";

const TRANSCRIPT = {
  id: "write-that-down:/Users/meetings-fixture/Transcripts/2026-09-10/08-05_42min.md",
  title: "Weekly sync",
  fileName: "08-05_42min.md",
  filePath: "/Users/meetings-fixture/Transcripts/2026-09-10/08-05_42min.md",
  relativePath: "2026-09-10/08-05_42min.md",
  dateFolder: "2026-09-10",
  startedAt: "2026-09-10 08:05",
  durationMinutes: 42,
  status: "saved",
  excerpt: "[00:00] hola",
  failureReason: null,
};

const AVAILABILITY = {
  status: "available",
  reason: "ready",
  platform: "macos",
  supported: true,
  installation: "installed",
  configuration: "configured",
  configured: true,
  configPath: "/Users/meetings-fixture/Library/Application Support/WriteThatDown/config.json",
  configPresent: true,
  transcriptRoot: "/Users/meetings-fixture/Transcripts",
  transcriptRootSource: "config",
  transcriptRootState: "readable",
  readOnly: true,
};

const PAGE = {
  availability: AVAILABILITY,
  meetings: [TRANSCRIPT],
  total: 1,
  offset: 0,
  limit: 50,
  hasMore: false,
  scanTruncated: false,
};

describe("dispatchMeetingsRequest", () => {
  it("forwards list with its paging params and validates the page", async () => {
    const call = vi.fn(async () => ({ ok: true as const, result: PAGE }));
    const result = await dispatchMeetingsRequest(
      { op: "list", params: { limit: 10, offset: 20 } },
      call,
    );
    expect(call).toHaveBeenCalledWith("meeting.list", { limit: 10, offset: 20 });
    expect(result).toEqual({ ok: true, result: PAGE });
  });

  it("forwards read and validates the outcome", async () => {
    const call = vi.fn(async () => ({
      ok: true as const,
      result: { meeting: TRANSCRIPT, content: "# Weekly sync\n", size: 14, truncated: false },
    }));
    const result = await dispatchMeetingsRequest(
      { op: "read", params: { id: TRANSCRIPT.id } },
      call,
    );
    expect(call).toHaveBeenCalledWith("meeting.read", { id: TRANSCRIPT.id });
    expect(result.ok).toBe(true);
  });

  it("refuses an unknown op or malformed params without calling the daemon", async () => {
    const call = vi.fn();
    for (const input of [
      undefined,
      {},
      { op: "delete", params: {} },
      { op: "list", params: { limit: 0 } },
      { op: "list", params: { limit: 201 } },
      { op: "read", params: {} },
      { op: "read", params: { id: "" } },
      // Unknown fields are refused outright: a typo must not silently
      // become "list everything".
      { op: "list", params: { limits: 5 } },
    ]) {
      const result = await dispatchMeetingsRequest(input, call);
      expect(result.ok).toBe(false);
    }
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses a daemon answer that violates the contract", async () => {
    const cases = [
      // readOnly false: the index must never claim it can write.
      { ...PAGE, availability: { ...AVAILABILITY, readOnly: false } },
      // A failed transcript without its reason.
      {
        ...PAGE,
        meetings: [{ ...TRANSCRIPT, status: "failed", failureReason: null }],
      },
      // A saved transcript without a duration.
      {
        ...PAGE,
        meetings: [{ ...TRANSCRIPT, status: "saved", durationMinutes: null }],
      },
      // An availability status that contradicts its reason.
      {
        ...PAGE,
        availability: { ...AVAILABILITY, reason: "not-a-real-reason" },
      },
    ];
    for (const result of cases) {
      const call = vi.fn(async () => ({ ok: true as const, result }));
      const response = await dispatchMeetingsRequest({ op: "list", params: {} }, call);
      expect(response.ok).toBe(false);
      if (!response.ok) expect(response.error.code).toBe("internal_error");
    }
  });

  it("passes a daemon refusal through unchanged", async () => {
    const failure = {
      ok: false as const,
      error: { code: "meeting_missing", message: "gone", retryable: false },
    };
    const call = vi.fn(async () => failure);
    const result = await dispatchMeetingsRequest(
      { op: "read", params: { id: "write-that-down:/x/y.md" } },
      call,
    );
    expect(result).toEqual(failure);
  });
});
