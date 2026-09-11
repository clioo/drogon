// MIT Copyright (c) 2026 Lovecast Inc.
// Fixtures shared by the Meetings renderer tests. Not a spec file: vitest
// collects `*.test.*` only. Every value here is on the wire shape the daemon
// actually sends, so a page test that passes is a page that can render a real
// answer.
import { vi } from "vitest";
import type {
  MeetingAnalysis,
  MeetingCommitment,
  MeetingCommitmentPage,
  MeetingSuggestion,
  MeetingTranscript,
  MeetingsAvailability,
  MeetingsBridge,
  MeetingsPage as MeetingsPageData,
} from "../../../../shared/meetings-contract";

export const NOTE_ID = "write-that-down:/home/carlos/Transcripts/2026-09-10/08-05_42min.md";
export const OLDER_NOTE_ID =
  "write-that-down:/home/carlos/Transcripts/2026-09-09/09-00_12min.md";

export function transcript(overrides: Partial<MeetingTranscript> = {}): MeetingTranscript {
  return {
    id: NOTE_ID,
    title: "Weekly sync",
    fileName: "08-05_42min.md",
    filePath: "/home/carlos/Transcripts/2026-09-10/08-05_42min.md",
    relativePath: "2026-09-10/08-05_42min.md",
    dateFolder: "2026-09-10",
    startedAt: "2026-09-10 08:05",
    durationMinutes: 42,
    status: "saved",
    excerpt: "[00:00] hola desde la reunion de hoy",
    failureReason: null,
    matches: [],
    matchCount: 0,
    searched: false,
    ...overrides,
  };
}

export function availability(
  overrides: Partial<MeetingsAvailability> = {},
): MeetingsAvailability {
  return {
    status: "available",
    reason: "ready",
    platform: "macos",
    supported: true,
    installation: "installed",
    configuration: "configured",
    configured: true,
    configPath: "/home/carlos/Library/Application Support/WriteThatDown/config.json",
    configPresent: true,
    transcriptRoot: "/home/carlos/Transcripts",
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
    ...overrides,
  };
}

export function page(overrides: Partial<MeetingsPageData> = {}): MeetingsPageData {
  const meetings = overrides.meetings ?? [transcript()];
  return {
    availability: availability(),
    meetings,
    total: meetings.length,
    offset: 0,
    limit: 50,
    hasMore: false,
    scanTruncated: false,
    filters: {
      query: null,
      from: null,
      to: null,
      minMinutes: null,
      maxMinutes: null,
    },
    scanned: 0,
    searched: false,
    ...overrides,
  };
}

export function suggestion(overrides: Partial<MeetingSuggestion> = {}): MeetingSuggestion {
  return {
    text: "Fix the flaky login test",
    quote: "[00:12] I will fix the flaky login test before the release.",
    line: 8,
    owner: "Carlos",
    due: null,
    confidence: "high",
    ...overrides,
  };
}

export function analysis(overrides: Partial<MeetingAnalysis> = {}): MeetingAnalysis {
  return {
    meeting: transcript(),
    model: "qwen3.8-flash-next-nvidia-nvfp4",
    provider: "dgx-spark",
    harness: "pi",
    summary: "The team agreed to ship the budget report on Friday.",
    decisions: [
      suggestion({
        text: "Ship the budget report on Friday",
        quote: "[00:00] We agreed to ship the budget report on Friday.",
        line: 7,
        owner: null,
      }),
    ],
    actions: [suggestion()],
    openQuestions: [],
    discarded: [{ text: "Migrate the database", reason: "quote-not-found" }],
    discardedCount: 1,
    transcriptTruncated: false,
    transcriptChars: 512,
    durationMs: 1_820,
    ...overrides,
  };
}

export function commitment(overrides: Partial<MeetingCommitment> = {}): MeetingCommitment {
  return {
    id: "commitment-1",
    meetingId: NOTE_ID,
    relativePath: "2026-09-10/08-05_42min.md",
    meetingTitle: "Weekly sync",
    meetingDate: "2026-09-10",
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
    ...overrides,
  };
}

export function commitmentPage(
  overrides: Partial<MeetingCommitmentPage> = {},
): MeetingCommitmentPage {
  const commitments = overrides.commitments ?? [commitment()];
  return {
    commitments,
    total: commitments.length,
    open: commitments.filter((entry) => entry.status === "open").length,
    offset: 0,
    limit: 200,
    hasMore: false,
    ...overrides,
  };
}

/** The bridge every page test drives; each method is a spy by default. */
export function bridgeFor(overrides: Partial<MeetingsBridge> = {}): MeetingsBridge {
  return {
    list: vi.fn(async () => ({ ok: true as const, result: page() })),
    read: vi.fn(async () => ({
      ok: true as const,
      result: {
        meeting: transcript(),
        content:
          "# Weekly sync\n**Date:** 2026-09-10 08:05\n**Duration:** 42 min\n\n## Transcript\n\n[00:00] hola desde la reunion de hoy\n",
        size: 100,
        truncated: false,
      },
    })),
    analyze: vi.fn(async () => ({ ok: true as const, result: analysis() })),
    commitments: vi.fn(async () => ({ ok: true as const, result: commitmentPage() })),
    accept: vi.fn(async () => ({ ok: true as const, result: commitment() })),
    resolve: vi.fn(async () => ({
      ok: true as const,
      result: commitment({ status: "done", resolvedAt: "2026-09-11T11:00:00Z" }),
    })),
    ...overrides,
  };
}
