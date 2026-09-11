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
  matches: [],
  matchCount: 0,
  searched: false,
};

const ANALYSIS = {
  meeting: TRANSCRIPT,
  model: "qwen3.8-flash-next-nvidia-nvfp4",
  provider: "dgx-spark",
  harness: "pi",
  summary: "The team agreed to ship the budget report.",
  decisions: [],
  actions: [
    {
      text: "Fix the flaky login test",
      quote: "[00:12] I will fix the flaky login test before the release.",
      line: 8,
      owner: "Carlos",
      due: null,
      confidence: "high",
    },
  ],
  openQuestions: [],
  discarded: [{ text: "Migrate the database", reason: "quote-not-found" }],
  discardedCount: 1,
  transcriptTruncated: false,
  transcriptChars: 512,
  durationMs: 1_820,
};

const COMMITMENT = {
  id: "commitment-1",
  meetingId: TRANSCRIPT.id,
  relativePath: TRANSCRIPT.relativePath,
  meetingTitle: TRANSCRIPT.title,
  meetingDate: TRANSCRIPT.dateFolder,
  text: "Fix the flaky login test",
  owner: "Carlos",
  quote: "[00:12] I will fix the flaky login test before the release.",
  line: 8,
  source: "suggested",
  confidence: "high",
  status: "open",
  createdAt: "2026-09-11T10:00:00Z",
  updatedAt: "2026-09-11T10:00:00Z",
  resolvedAt: null,
};

const COMMITMENT_PAGE = {
  commitments: [COMMITMENT],
  total: 1,
  open: 1,
  offset: 0,
  limit: 200,
  hasMore: false,
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
  analysis: {
    available: true,
    reason: "ready",
    harness: "pi",
    provider: "dgx-spark",
    model: "qwen3.8-flash-next-nvidia-nvfp4",
    freeLocalModel: true,
  },
};

const PAGE = {
  availability: AVAILABILITY,
  meetings: [TRANSCRIPT],
  total: 1,
  offset: 0,
  limit: 50,
  hasMore: false,
  scanTruncated: false,
  filters: { query: null, from: null, to: null, minMinutes: null, maxMinutes: null },
  scanned: 0,
  searched: false,
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

  it("forwards search and filters instead of filtering one page locally", async () => {
    const call = vi.fn(async () => ({ ok: true as const, result: PAGE }));
    await dispatchMeetingsRequest(
      {
        op: "list",
        params: { query: "budget", from: "2026-09-01", minMinutes: 15, limit: 50 },
      },
      call,
    );
    expect(call).toHaveBeenCalledWith("meeting.list", {
      query: "budget",
      from: "2026-09-01",
      minMinutes: 15,
      limit: 50,
    });
    // A blank query is refused here rather than answered with "0 results".
    expect(
      await dispatchMeetingsRequest({ op: "list", params: { query: "   " } }, call),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Invalid meetings request.",
        retryable: false,
      },
    });
    expect(
      await dispatchMeetingsRequest(
        { op: "list", params: { from: "2026-09-10", to: "2026-09-01" } },
        call,
      ),
    ).toMatchObject({ ok: false });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("forwards analyze and validates the verified-suggestion answer", async () => {
    const call = vi.fn(async () => ({ ok: true as const, result: ANALYSIS }));
    const result = await dispatchMeetingsRequest(
      { op: "analyze", params: { id: TRANSCRIPT.id } },
      call,
    );
    expect(call).toHaveBeenCalledWith("meeting.analyze", { id: TRANSCRIPT.id });
    expect(result).toEqual({ ok: true, result: ANALYSIS });

    // A finding without a verified line never reaches the renderer.
    const liar = vi.fn(async () => ({
      ok: true as const,
      result: { ...ANALYSIS, actions: [{ ...ANALYSIS.actions[0], line: 0 }] },
    }));
    expect(
      await dispatchMeetingsRequest({ op: "analyze", params: { id: TRANSCRIPT.id } }, liar),
    ).toMatchObject({ ok: false });
    // Neither does an analysis that names another model.
    const paid = vi.fn(async () => ({
      ok: true as const,
      result: { ...ANALYSIS, provider: "openai" },
    }));
    expect(
      await dispatchMeetingsRequest({ op: "analyze", params: { id: TRANSCRIPT.id } }, paid),
    ).toMatchObject({ ok: false });
  });

  it("forwards the ledger reads and writes, and refuses a weak quote", async () => {
    const call = vi.fn(async () => ({ ok: true as const, result: COMMITMENT_PAGE }));
    await dispatchMeetingsRequest(
      { op: "commitments", params: { status: "open", query: "login" } },
      call,
    );
    expect(call).toHaveBeenCalledWith("meeting.commitment_list", {
      status: "open",
      query: "login",
    });

    const create = vi.fn(async () => ({ ok: true as const, result: COMMITMENT }));
    const accepted = await dispatchMeetingsRequest(
      {
        op: "accept",
        params: {
          meetingId: TRANSCRIPT.id,
          text: "Fix the flaky login test",
          quote: "[00:12] I will fix the flaky login test before the release.",
          owner: "Carlos",
          source: "suggested",
          confidence: "high",
        },
      },
      create,
    );
    expect(create).toHaveBeenCalledWith("meeting.commitment_create", {
      meetingId: TRANSCRIPT.id,
      text: "Fix the flaky login test",
      quote: "[00:12] I will fix the flaky login test before the release.",
      owner: "Carlos",
      source: "suggested",
      confidence: "high",
    });
    expect(accepted).toEqual({ ok: true, result: COMMITMENT });
    // A quote too short to be evidence is refused before it leaves the app.
    expect(
      await dispatchMeetingsRequest(
        {
          op: "accept",
          params: {
            meetingId: TRANSCRIPT.id,
            text: "Own MR 142",
            quote: "MR 142",
            source: "owner",
          },
        },
        create,
      ),
    ).toMatchObject({ ok: false });
    // An omitted source is refused: "who said this" is part of the record.
    expect(
      await dispatchMeetingsRequest(
        {
          op: "accept",
          params: {
            meetingId: TRANSCRIPT.id,
            text: "t",
            quote: "[00:12] I will fix the flaky login test before the release.",
          },
        },
        create,
      ),
    ).toMatchObject({ ok: false });
    expect(create).toHaveBeenCalledTimes(1);

    const resolve = vi.fn(async () => ({
      ok: true as const,
      result: { ...COMMITMENT, status: "done", resolvedAt: "2026-09-11T11:00:00Z" },
    }));
    await dispatchMeetingsRequest(
      { op: "resolve", params: { id: "commitment-1", status: "done" } },
      resolve,
    );
    expect(resolve).toHaveBeenCalledWith("meeting.commitment_update", {
      id: "commitment-1",
      status: "done",
    });
    // An unknown status is refused, so the ledger never carries a state the
    // contract does not define.
    expect(
      await dispatchMeetingsRequest(
        { op: "resolve", params: { id: "commitment-1", status: "cancelled" } },
        resolve,
      ),
    ).toMatchObject({ ok: false });
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});