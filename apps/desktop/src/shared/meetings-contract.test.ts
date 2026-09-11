// MIT Copyright (c) 2026 Lovecast Inc.
// Shared meetings contract: the invariants the page and the main bridge both
// rely on, pinned at the schema level so a drifting daemon answer can never
// be rendered as a truthful-looking state.
import { describe, expect, it } from "vitest";
import { resultSchemas } from "./result-validation";
import {
  DEFAULT_MEETINGS_PAGE,
  MAX_COMMITMENT_PAGE,
  MAX_MEETINGS_PAGE,
  MAX_TRANSCRIPT_BYTES,
  MEETINGS_ACTIONS_CAPABILITY,
  MEETINGS_ANALYSIS_MODEL,
  MEETINGS_ANALYSIS_PROVIDER,
  meetingAnalysisSchema,
  meetingCommitmentPageSchema,
  meetingCommitmentSchema,
  meetingsPageSchema,
  meetingsReadInputSchema,
  meetingReadSchema,
  meetingTranscriptSchema,
  meetingsRequestSchema,
} from "./meetings-contract";

const availability = {
  status: "available" as const,
  reason: "ready" as const,
  platform: "macos",
  supported: true,
  installation: "installed" as const,
  configuration: "configured" as const,
  configured: true,
  configPath: "/Users/meetings-fixture/Library/Application Support/WriteThatDown/config.json",
  configPresent: true,
  transcriptRoot: "/Users/meetings-fixture/Transcripts",
  transcriptRootSource: "config" as const,
  transcriptRootState: "readable" as const,
  readOnly: true,
  analysis: {
    available: true,
    reason: "ready" as const,
    harness: "pi",
    provider: "dgx-spark",
    model: "qwen3.8-flash-next-nvidia-nvfp4",
    freeLocalModel: true as const,
  },
};

const transcript = {
  id: "write-that-down:/Users/meetings-fixture/Transcripts/2026-09-10/08-05_42min.md",
  title: "Weekly sync",
  fileName: "08-05_42min.md",
  filePath: "/Users/meetings-fixture/Transcripts/2026-09-10/08-05_42min.md",
  relativePath: "2026-09-10/08-05_42min.md",
  dateFolder: "2026-09-10",
  startedAt: "2026-09-10 08:05",
  durationMinutes: 42,
  status: "saved" as const,
  excerpt: "[00:00] hola",
  failureReason: null,
  matches: [],
  matchCount: 0,
  searched: false,
};

const suggestion = {
  text: "Fix the flaky login test",
  quote: "[00:12] I will fix the flaky login test before the release.",
  line: 8,
  owner: "Carlos",
  due: null,
  confidence: "high" as const,
};

const analysis = {
  meeting: transcript,
  model: MEETINGS_ANALYSIS_MODEL,
  provider: MEETINGS_ANALYSIS_PROVIDER,
  harness: "pi",
  summary: "The team agreed to ship the budget report.",
  decisions: [suggestion],
  actions: [suggestion],
  openQuestions: [],
  discarded: [{ text: "Migrate the database", reason: "quote-not-found" as const }],
  discardedCount: 1,
  transcriptTruncated: false,
  transcriptChars: 512,
  durationMs: 1_820,
};

const commitment = {
  id: "commitment-1",
  meetingId: transcript.id,
  relativePath: transcript.relativePath,
  meetingTitle: transcript.title,
  meetingDate: transcript.dateFolder,
  text: "Fix the flaky login test",
  owner: "Carlos",
  quote: suggestion.quote,
  line: 8,
  source: "suggested" as const,
  confidence: "high" as const,
  status: "open" as const,
  createdAt: "2026-09-11T10:00:00Z",
  updatedAt: "2026-09-11T10:00:00Z",
  resolvedAt: null,
};

describe("meetings contract", () => {
  it("pins the page and byte budgets", () => {
    expect(DEFAULT_MEETINGS_PAGE).toBe(50);
    expect(MAX_MEETINGS_PAGE).toBe(200);
    expect(MAX_TRANSCRIPT_BYTES).toBe(5 * 1024 * 1024);
  });

  it("accepts a well-formed transcript and refuses one that lies", () => {
    expect(meetingTranscriptSchema.safeParse(transcript).success).toBe(true);
    // A failed transcript must name its reason.
    expect(
      meetingTranscriptSchema.safeParse({
        ...transcript,
        status: "failed",
        failureReason: null,
      }).success,
    ).toBe(false);
    // A healthy one must not.
    expect(
      meetingTranscriptSchema.safeParse({
        ...transcript,
        failureReason: "malformed-transcript",
      }).success,
    ).toBe(false);
    // A saved transcript has a duration; a recording one does not.
    expect(
      meetingTranscriptSchema.safeParse({ ...transcript, durationMinutes: null }).success,
    ).toBe(false);
    expect(
      meetingTranscriptSchema.safeParse({
        ...transcript,
        status: "recording",
        durationMinutes: 3,
      }).success,
    ).toBe(false);
    expect(
      meetingTranscriptSchema.safeParse({
        ...transcript,
        status: "recording",
        durationMinutes: null,
      }).success,
    ).toBe(true);
    // Foreign ids are not transcripts.
    expect(
      meetingTranscriptSchema.safeParse({ ...transcript, id: "/etc/hosts" }).success,
    ).toBe(false);
  });

  it("requires the index to report itself read-only", () => {
    const page = {
      availability,
      meetings: [transcript],
      total: 1,
      offset: 0,
      limit: 50,
      hasMore: false,
      scanTruncated: false,
      filters: { query: null, from: null, to: null, minMinutes: null, maxMinutes: null },
      scanned: 0,
      searched: false,
    };
    expect(meetingsPageSchema.safeParse(page).success).toBe(true);
    expect(
      meetingsPageSchema.safeParse({
        ...page,
        availability: { ...availability, readOnly: false },
      }).success,
    ).toBe(false);
    // Every documented reason is accepted; anything else is not.
    for (const reason of [
      "unsupported-platform",
      "not-installed",
      "invalid-configuration",
      "transcript-root-missing",
      "transcript-root-unreadable",
      "empty",
      "ready",
    ]) {
      expect(
        meetingsPageSchema.safeParse({ ...page, availability: { ...availability, reason } })
          .success,
      ).toBe(true);
    }
    expect(
      meetingsPageSchema.safeParse({
        ...page,
        availability: { ...availability, reason: "bridge-unavailable" },
      }).success,
    ).toBe(false);
  });

  it("bounds the read body and its inputs", () => {
    expect(
      meetingReadSchema.safeParse({
        meeting: transcript,
        content: "x",
        size: 1,
        truncated: false,
      }).success,
    ).toBe(true);
    expect(
      meetingReadSchema.safeParse({ meeting: transcript, content: "x", size: 1 }).success,
    ).toBe(false);
    expect(meetingsReadInputSchema.safeParse({ id: "write-that-down:/x/y.md" }).success).toBe(true);
    expect(meetingsReadInputSchema.safeParse({ id: "" }).success).toBe(false);
    expect(
      meetingsReadInputSchema.safeParse({ id: "x", maxBytes: MAX_TRANSCRIPT_BYTES + 1 }).success,
    ).toBe(false);
    expect(meetingsReadInputSchema.safeParse({ id: "x", maxBytes: 0 }).success).toBe(false);
    expect(
      meetingsReadInputSchema.safeParse({ id: "x", maxBytes: MAX_TRANSCRIPT_BYTES }).success,
    ).toBe(true);
  });

  it("accepts exactly the six documented operations", () => {
    expect(meetingsRequestSchema.safeParse({ op: "list" }).success).toBe(true);
    expect(meetingsRequestSchema.safeParse({ op: "list", params: { limit: 5 } }).success).toBe(
      true,
    );
    expect(meetingsRequestSchema.safeParse({ op: "read", params: { id: "x" } }).success).toBe(true);
    expect(meetingsRequestSchema.safeParse({ op: "analyze", params: { id: "x" } }).success).toBe(
      true,
    );
    expect(meetingsRequestSchema.safeParse({ op: "commitments" }).success).toBe(true);
    expect(
      meetingsRequestSchema.safeParse({
        op: "accept",
        params: {
          meetingId: "write-that-down:/x/y.md",
          text: "t",
          quote: "a quote long enough",
          source: "suggested",
        },
      }).success,
    ).toBe(true);
    expect(
      meetingsRequestSchema.safeParse({ op: "resolve", params: { id: "c1", status: "done" } })
        .success,
    ).toBe(true);
    expect(meetingsRequestSchema.safeParse({ op: "delete", params: { id: "x" } }).success).toBe(
      false,
    );
    expect(meetingsRequestSchema.safeParse({ op: "read" }).success).toBe(false);
    expect(
      meetingsRequestSchema.safeParse({ op: "list", params: { limit: MAX_MEETINGS_PAGE + 1 } })
        .success,
    ).toBe(false);
  });

  it("refuses the filter shapes the daemon would refuse", () => {
    for (const params of [
      { query: "   " },
      { query: "x".repeat(201) },
      { query: " padded " },
      { from: "2026-9-1" },
      { to: "yesterday" },
      { from: "2026-09-10", to: "2026-09-01" },
      { minMinutes: 90, maxMinutes: 10 },
      { minMinutes: 44_641 },
      { minuts: 10 },
    ]) {
      expect(
        meetingsRequestSchema.safeParse({ op: "list", params }).success,
        JSON.stringify(params),
      ).toBe(false);
    }
    expect(
      meetingsRequestSchema.safeParse({
        op: "list",
        params: { query: "budget", from: "2026-09-01", to: "2026-09-30", minMinutes: 5 },
      }).success,
    ).toBe(true);
  });

  it("never reports a searched row and its page as disagreeing", () => {
    const searchedRow = {
      ...transcript,
      searched: true,
      matchCount: 2,
      matches: [{ line: 7, text: "[00:00] we agreed to ship the budget report" }],
    };
    const base = {
      availability,
      meetings: [searchedRow],
      total: 1,
      offset: 0,
      limit: 50,
      hasMore: false,
      scanTruncated: false,
      filters: { query: "budget", from: null, to: null, minMinutes: null, maxMinutes: null },
      scanned: 327,
      searched: true,
    };
    expect(meetingsPageSchema.safeParse(base).success).toBe(true);
    // A row that says it was searched but reports no match is a lie.
    expect(
      meetingsPageSchema.safeParse({
        ...base,
        meetings: [{ ...searchedRow, matchCount: 0, matches: [] }],
      }).success,
    ).toBe(false);
    // A row that reports matches without a search is one too.
    expect(
      meetingsPageSchema.safeParse({
        ...base,
        meetings: [{ ...searchedRow, searched: false }],
      }).success,
    ).toBe(false);
    // And a row contradicts its page.
    expect(
      meetingsPageSchema.safeParse({ ...base, searched: false }).success,
    ).toBe(false);
  });

  it("pins the extraction to the free local model", () => {
    expect(MEETINGS_ANALYSIS_MODEL).toBe("qwen3.8-flash-next-nvidia-nvfp4");
    expect(MEETINGS_ANALYSIS_PROVIDER).toBe("dgx-spark");
    expect(MEETINGS_ACTIONS_CAPABILITY).toBe("meetings.actions.v1");
    expect(meetingAnalysisSchema.safeParse(analysis).success).toBe(true);
    // Another provider or model is refused on the wire as well as upstream.
    expect(
      meetingAnalysisSchema.safeParse({ ...analysis, provider: "openai" }).success,
    ).toBe(false);
    expect(meetingAnalysisSchema.safeParse({ ...analysis, model: "gpt-5" }).success).toBe(false);
    expect(
      meetingAnalysisSchema.safeParse({
        ...analysis,
        discarded: [...analysis.discarded, { text: "x", reason: "quote-not-found" }],
        discardedCount: 1,
      }).success,
    ).toBe(false);
    // A suggestion without the line it came from is not a finding.
    expect(
      meetingAnalysisSchema.safeParse({
        ...analysis,
        actions: [{ ...suggestion, line: 0 }],
      }).success,
    ).toBe(false);
    // A quote too short to be evidence is refused.
    expect(
      meetingAnalysisSchema.safeParse({
        ...analysis,
        actions: [{ ...suggestion, quote: "MR 142" }],
      }).success,
    ).toBe(false);
    // A suggestion that was not verified has no shape it can travel in.
    expect(
      meetingAnalysisSchema.safeParse({
        ...analysis,
        actions: [{ ...suggestion, verified: false }],
      }).success,
    ).toBe(false);
  });

  it("keeps an availability answer honest about extraction too", () => {
    expect(
      meetingsPageSchema.safeParse({
        availability: {
          ...availability,
          analysis: { ...availability.analysis, freeLocalModel: false },
        },
        meetings: [],
        total: 0,
        offset: 0,
        limit: 50,
        hasMore: false,
        scanTruncated: false,
        filters: { query: null, from: null, to: null, minMinutes: null, maxMinutes: null },
        scanned: 0,
        searched: false,
      }).success,
    ).toBe(false);
    expect(
      meetingsPageSchema.safeParse({
        availability: { ...availability, analysis: { available: true, reason: "harness-missing" } },
        meetings: [],
        total: 0,
        offset: 0,
        limit: 50,
        hasMore: false,
        scanTruncated: false,
        filters: { query: null, from: null, to: null, minMinutes: null, maxMinutes: null },
        scanned: 0,
        searched: false,
      }).success,
    ).toBe(false);
  });

  it("bounds a commitment and its page", () => {
    expect(MAX_COMMITMENT_PAGE).toBe(200);
    expect(meetingCommitmentSchema.safeParse(commitment).success).toBe(true);
    expect(
      meetingCommitmentSchema.safeParse({
        ...commitment,
        status: "done",
        resolvedAt: null,
      }).success,
    ).toBe(false);
    expect(
      meetingCommitmentSchema.safeParse({
        ...commitment,
        status: "open",
        resolvedAt: "2026-09-11T11:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      meetingCommitmentSchema.safeParse({ ...commitment, line: 0 }).success,
    ).toBe(false);
    expect(
      meetingCommitmentSchema.safeParse({ ...commitment, source: "model" }).success,
    ).toBe(false);
    expect(
      meetingCommitmentSchema.safeParse({ ...commitment, meetingId: "/etc/passwd" }).success,
    ).toBe(false);

    const page = { commitments: [commitment], total: 1, open: 1, offset: 0, limit: 200, hasMore: false };
    expect(meetingCommitmentPageSchema.safeParse(page).success).toBe(true);
    expect(
      meetingCommitmentPageSchema.safeParse({ ...page, commitments: [commitment, commitment], total: 1 })
        .success,
    ).toBe(false);
    expect(meetingCommitmentPageSchema.safeParse({ ...page, limit: 0 }).success).toBe(false);
  });

  it("registers every meetings method in the wire result schemas", () => {
    // The daemon's replies are validated per method on the socket before the
    // bridge ever sees them. A method missing from this table is refused as
    // "does not match the expected contract" at runtime — which is exactly
    // what happened once, so it is pinned here.
    const methods = [
      "meeting.list",
      "meeting.read",
      "meeting.analyze",
      "meeting.commitment_list",
      "meeting.commitment_create",
      "meeting.commitment_update",
    ] as const;
    for (const method of methods) {
      expect(resultSchemas[method], method).toBeTruthy();
    }
    expect(resultSchemas["meeting.analyze"].safeParse(analysis).success).toBe(true);
    expect(
      resultSchemas["meeting.commitment_update"].safeParse({
        ...commitment,
        status: "done",
        resolvedAt: "2026-09-11T11:00:00Z",
      }).success,
    ).toBe(true);
    expect(
      resultSchemas["meeting.commitment_create"].safeParse({
        ...commitment,
        status: "open",
        resolvedAt: "2026-09-11T11:00:00Z",
      }).success,
    ).toBe(false);
    // No stale entries: every method the contract names is present, and the
    // analysis probe the daemon does not expose is not.
    expect(Object.keys(resultSchemas).filter((key) => key.startsWith("meeting."))).toEqual(
      [...methods],
    );
  });
});