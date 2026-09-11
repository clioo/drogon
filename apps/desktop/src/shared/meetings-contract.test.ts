// MIT Copyright (c) 2026 Lovecast Inc.
// Shared meetings contract: the invariants the page and the main bridge both
// rely on, pinned at the schema level so a drifting daemon answer can never
// be rendered as a truthful-looking state.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEETINGS_PAGE,
  MAX_MEETINGS_PAGE,
  MAX_TRANSCRIPT_BYTES,
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
    const page = { availability, meetings: [transcript], total: 1, offset: 0, limit: 50, hasMore: false, scanTruncated: false };
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

  it("accepts exactly the two read-only operations", () => {
    expect(meetingsRequestSchema.safeParse({ op: "list" }).success).toBe(true);
    expect(meetingsRequestSchema.safeParse({ op: "list", params: { limit: 5 } }).success).toBe(
      true,
    );
    expect(meetingsRequestSchema.safeParse({ op: "read", params: { id: "x" } }).success).toBe(true);
    expect(meetingsRequestSchema.safeParse({ op: "delete", params: { id: "x" } }).success).toBe(
      false,
    );
    expect(meetingsRequestSchema.safeParse({ op: "read" }).success).toBe(false);
    expect(
      meetingsRequestSchema.safeParse({ op: "list", params: { limit: MAX_MEETINGS_PAGE + 1 } })
        .success,
    ).toBe(false);
  });
});
