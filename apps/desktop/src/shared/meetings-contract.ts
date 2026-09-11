// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from orca-drogon: src/shared/drogon-meeting-contract.ts (types,
// parsing rules and the availability taxonomy) and
// src/preload/api/meetings-api.ts (the bridge surface). Data-layer
// adaptations are listed in the PR: this build has no capture side (the
// fork's live-capture adapter and speech-model readiness are not part of
// Drogon's read-only Meetings surface), the folder picker override
// (`drogon-meetings.json`) is not ported — resolution follows Write That
// Down's own precedence only — and the availability reasons are the ones
// this daemon can actually observe, including an explicit `empty`.
import { z } from "zod";
import type { Result } from "./session-contract";

/** Service capability the desktop surface and the CLI both gate on. */
export const MEETINGS_CAPABILITY = "meetings.v1";
/**
 * Extraction and the commitment ledger are a separate, additive capability:
 * a service that only indexes still lists and searches, and the page shows
 * the actions as unavailable with the daemon's own reason instead of
 * offering a button that cannot work.
 */
export const MEETINGS_ACTIONS_CAPABILITY = "meetings.actions.v1";
export const DEFAULT_MEETINGS_PAGE = 50;
export const MAX_MEETINGS_PAGE = 200;
/** Write That Down's own per-transcript cap. */
export const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;
/** Longest admitted search string, in characters (mirrors the daemon). */
export const MAX_MEETINGS_QUERY_CHARS = 200;
/** Shortest quote that counts as evidence for a commitment. */
export const MIN_COMMITMENT_QUOTE_CHARS = 12;
export const DEFAULT_COMMITMENT_PAGE = 50;
export const MAX_COMMITMENT_PAGE = 200;
export const MAX_COMMITMENT_TEXT_CHARS = 500;
/**
 * The one model extraction may use. Fixed here as well as in the daemon so
 * the renderer physically cannot offer another: the owner must never be
 * billed for browsing his own meetings.
 */
export const MEETINGS_ANALYSIS_MODEL = "qwen3.8-flash-next-nvidia-nvfp4";
export const MEETINGS_ANALYSIS_PROVIDER = "dgx-spark";
export const MEETINGS_ANALYSIS_HARNESS = "pi";

export type MeetingStatus = "recording" | "saved" | "failed";

export type MeetingFailureReason =
  | "malformed-transcript"
  | "unreadable-transcript"
  | "oversized-transcript";

/**
 * Where the notes folder came from: Write That Down's own default
 * (`~/Transcripts`), its `config.json` `outputDir`, or `WTD_OUTPUT_DIR`.
 */
export type MeetingRootSource = "default" | "config" | "environment";

/** Independent of the headline reason, so a missing folder is always named. */
export type MeetingRootState = "readable" | "missing" | "unreadable";

export type MeetingInstallation = "installed" | "not-installed" | "unsupported";
export type MeetingConfiguration = "defaults" | "configured" | "invalid";

/**
 * The headline answer. `empty` and `ready` both mean the folder is readable;
 * `transcript-root-missing` and `transcript-root-unreadable` must never be
 * rendered as "you have had no meetings".
 */
export type MeetingAvailabilityReason =
  | "unsupported-platform"
  | "not-installed"
  | "invalid-configuration"
  | "transcript-root-missing"
  | "transcript-root-unreadable"
  | "empty"
  | "ready";

/** Whether this host can extract at all, and with what. */
export type MeetingAnalysisStatus = {
  available: boolean;
  reason: "ready" | "harness-missing";
  harness: string;
  provider: string;
  model: string;
  /** Always true: extraction only ever uses the free local model. */
  freeLocalModel: boolean;
};

export type MeetingsAvailability = {
  status: "available" | "unavailable";
  reason: MeetingAvailabilityReason;
  platform: string;
  supported: boolean;
  installation: MeetingInstallation;
  configuration: MeetingConfiguration;
  configured: boolean;
  configPath: string;
  configPresent: boolean;
  transcriptRoot: string;
  transcriptRootSource: MeetingRootSource;
  transcriptRootState: MeetingRootState;
  /** Always true: Drogon indexes and displays the notes, never writes them. */
  readOnly: boolean;
  analysis: MeetingAnalysisStatus;
};

/** One transcript line a search matched, with its number in the note. */
export type MeetingMatchLine = {
  line: number;
  text: string;
};

export type MeetingTranscript = {
  id: string;
  title: string;
  fileName: string;
  filePath: string;
  /** Path relative to the notes folder: `YYYY-MM-DD/HH-MM_42min.md`. */
  relativePath: string;
  dateFolder: string;
  /** Local start time as the tool recorded it: `YYYY-MM-DD HH:MM`. */
  startedAt: string | null;
  durationMinutes: number | null;
  status: MeetingStatus;
  excerpt: string;
  failureReason: MeetingFailureReason | null;
  /** The transcript lines the query matched, with their line numbers. */
  matches: MeetingMatchLine[];
  /** Every occurrence of the query in the note, not just the lines carried. */
  matchCount: number;
  /** True only for rows a text search produced. */
  searched: boolean;
};

/**
 * The filter set a list request carries. Every field is optional and an
 * absent field is "no filter", never "match nothing".
 */
export type MeetingFilters = {
  query?: string;
  /** Inclusive `YYYY-MM-DD` bounds on the meeting date. */
  from?: string;
  to?: string;
  /** Duration bounds in minutes; only finalized transcripts can match. */
  minMinutes?: number;
  maxMinutes?: number;
};

/** The filter set the daemon actually applied, echoed back. */
export type AppliedMeetingFilters = {
  query: string | null;
  from: string | null;
  to: string | null;
  minMinutes: number | null;
  maxMinutes: number | null;
};

export type MeetingsPage = {
  availability: MeetingsAvailability;
  meetings: MeetingTranscript[];
  total: number;
  offset: number;
  limit: number;
  /** More meetings exist beyond this page (`--offset` further). */
  hasMore: boolean;
  /** The index stopped at its own scan budget: `total` is a lower bound. */
  scanTruncated: boolean;
  filters: AppliedMeetingFilters;
  /** Transcript files whose text a search read (0 without a query). */
  scanned: number;
  /** True when the request carried a text query. */
  searched: boolean;
};

/** One extracted suggestion, with the transcript line that proves it. */
export type MeetingSuggestion = {
  text: string;
  /** Verbatim line from the note. */
  quote: string;
  /** 1-based line number of `quote` in the note. */
  line: number;
  owner: string | null;
  due: string | null;
  confidence: "high" | "low";
};

/** A suggestion verification refused, and why. Never a finding. */
export type MeetingDiscardedSuggestion = {
  text: string;
  reason: "quote-not-found" | "quote-too-short" | "empty-text";
};

/**
 * One local-model analysis. Every item in `decisions`/`actions`/
 * `openQuestions` was verified against the note before it reached the page;
 * everything verification refused is in `discarded`, with its reason.
 */
export type MeetingAnalysis = {
  meeting: MeetingTranscript;
  model: string;
  provider: string;
  harness: string;
  summary: string;
  decisions: MeetingSuggestion[];
  actions: MeetingSuggestion[];
  openQuestions: MeetingSuggestion[];
  discarded: MeetingDiscardedSuggestion[];
  discardedCount: number;
  /** Only the first bytes of the note were analysed (the prompt budget). */
  transcriptTruncated: boolean;
  transcriptChars: number;
  durationMs: number;
};

export type MeetingCommitmentStatus = "open" | "done" | "dismissed";
/** `suggested` = the local model proposed it and the owner accepted. */
export type MeetingCommitmentSource = "suggested" | "owner";

/** One accepted commitment: tracked work with the quote that supports it. */
export type MeetingCommitment = {
  id: string;
  meetingId: string;
  relativePath: string;
  meetingTitle: string;
  meetingDate: string;
  text: string;
  owner: string | null;
  quote: string;
  line: number;
  source: MeetingCommitmentSource;
  confidence: "high" | "low";
  status: MeetingCommitmentStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type MeetingCommitmentPage = {
  commitments: MeetingCommitment[];
  total: number;
  /** Open commitments matching the filter, whatever this page shows. */
  open: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

export type MeetingRead = {
  meeting: MeetingTranscript;
  content: string;
  size: number;
  /** `content` is a complete prefix, cut on a UTF-8 boundary. */
  truncated: boolean;
};

export type MeetingsListInput = MeetingFilters & {
  limit?: number;
  offset?: number;
};

export type MeetingCommitmentsQuery = {
  status?: MeetingCommitmentStatus;
  open?: boolean;
  query?: string;
  limit?: number;
  offset?: number;
};

export interface MeetingsBridge {
  list(input?: MeetingsListInput): Promise<Result<MeetingsPage>>;
  read(input: {
    id: string;
    maxBytes?: number;
  }): Promise<Result<MeetingRead>>;
  /** Runs the free local model once over one note. Creates nothing. */
  analyze(input: { id: string }): Promise<Result<MeetingAnalysis>>;
  commitments(input?: MeetingCommitmentsQuery): Promise<Result<MeetingCommitmentPage>>;
  /** The explicit acceptance step; the daemon re-verifies the quote. */
  accept(input: {
    meetingId: string;
    text: string;
    quote: string;
    owner?: string;
    source: MeetingCommitmentSource;
    confidence?: "high" | "low";
  }): Promise<Result<MeetingCommitment>>;
  resolve(input: {
    id: string;
    status: Exclude<MeetingCommitmentStatus, "open"> | "open";
  }): Promise<Result<MeetingCommitment>>;
}

declare module "./session-contract" {
  interface DesktopBridge {
    /** Optional: an older bridge (or a build without the meetings bridge)
     *  simply has no namespace, and the page says so instead of guessing. */
    meetings?: MeetingsBridge;
  }
}

const meetingStatusSchema = z.enum(["recording", "saved", "failed"]);
const meetingFailureReasonSchema = z.enum([
  "malformed-transcript",
  "unreadable-transcript",
  "oversized-transcript",
]);
const meetingAvailabilityReasonSchema = z.enum([
  "unsupported-platform",
  "not-installed",
  "invalid-configuration",
  "transcript-root-missing",
  "transcript-root-unreadable",
  "empty",
  "ready",
]);

export const meetingAnalysisStatusSchema = z
  .object({
    available: z.boolean(),
    reason: z.enum(["ready", "harness-missing"]),
    harness: z.literal(MEETINGS_ANALYSIS_HARNESS),
    provider: z.literal(MEETINGS_ANALYSIS_PROVIDER),
    model: z.literal(MEETINGS_ANALYSIS_MODEL),
    freeLocalModel: z.literal(true),
  })
  .strict();

export const meetingMatchLineSchema = z
  .object({
    line: z.number().int().min(1),
    text: z.string().min(1),
  })
  .strict();

export const meetingSuggestionSchema = z
  .object({
    text: z.string().min(1),
    quote: z.string().min(MIN_COMMITMENT_QUOTE_CHARS),
    line: z.number().int().min(1),
    owner: z.string().min(1).nullable(),
    due: z.string().min(1).nullable(),
    confidence: z.enum(["high", "low"]),
  })
  .strict();

export const meetingCommitmentSchema = z
  .object({
    id: z.string().min(1),
    meetingId: z.string().startsWith("write-that-down:"),
    relativePath: z.string().min(1),
    meetingTitle: z.string().min(1),
    meetingDate: z.string().min(1),
    text: z.string().min(1).max(MAX_COMMITMENT_TEXT_CHARS),
    owner: z.string().min(1).nullable(),
    quote: z.string().min(1),
    line: z.number().int().min(1),
    source: z.enum(["suggested", "owner"]),
    confidence: z.enum(["high", "low"]),
    status: z.enum(["open", "done", "dismissed"]),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    resolvedAt: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((commitment, ctx) => {
    // An open commitment has no resolution time and a resolved one must have
    // one; "done" and "dismissed" are different answers, never a single
    // "closed" flag.
    if (commitment.status === "open" && commitment.resolvedAt !== null) {
      ctx.addIssue({
        code: "custom",
        message: "an open commitment must not carry resolvedAt",
        path: ["resolvedAt"],
      });
    }
    if (commitment.status !== "open" && commitment.resolvedAt === null) {
      ctx.addIssue({
        code: "custom",
        message: "a resolved commitment must carry resolvedAt",
        path: ["resolvedAt"],
      });
    }
  });

export const meetingCommitmentPageSchema = z
  .object({
    commitments: z.array(meetingCommitmentSchema).max(MAX_COMMITMENT_PAGE),
    total: z.number().int().min(0),
    open: z.number().int().min(0),
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(MAX_COMMITMENT_PAGE),
    hasMore: z.boolean(),
  })
  .strict()
  .refine(
    (page) => page.commitments.length <= page.total,
    "a page cannot carry more rows than the reported total",
  );

export const meetingsAvailabilitySchema = z
  .object({
    status: z.enum(["available", "unavailable"]),
    reason: meetingAvailabilityReasonSchema,
    platform: z.string(),
    supported: z.boolean(),
    installation: z.enum(["installed", "not-installed", "unsupported"]),
    configuration: z.enum(["defaults", "configured", "invalid"]),
    configured: z.boolean(),
    configPath: z.string(),
    configPresent: z.boolean(),
    transcriptRoot: z.string().min(1),
    transcriptRootSource: z.enum(["default", "config", "environment"]),
    transcriptRootState: z.enum(["readable", "missing", "unreadable"]),
    readOnly: z.boolean(),
    analysis: meetingAnalysisStatusSchema,
  })
  .strict();

/**
 * The invariants the page relies on, enforced at the bridge: a failed
 * transcript always names its reason, a healthy one never carries one, a
 * `saved` meeting has a duration and a `recording` one does not, and the
 * index is always read-only.
 */
export const meetingTranscriptSchema = z
  .object({
    id: z.string().startsWith("write-that-down:"),
    title: z.string().min(1),
    fileName: z.string().min(1),
    filePath: z.string().min(1),
    relativePath: z.string().min(1),
    dateFolder: z.string().min(1),
    startedAt: z.string().nullable(),
    durationMinutes: z.number().int().min(0).nullable(),
    status: meetingStatusSchema,
    excerpt: z.string(),
    failureReason: meetingFailureReasonSchema.nullable(),
    matches: z.array(meetingMatchLineSchema).max(3),
    matchCount: z.number().int().min(0),
    searched: z.boolean(),
  })
  .strict()
  .superRefine((meeting, ctx) => {
    if (meeting.status === "failed" && meeting.failureReason === null) {
      ctx.addIssue({
        code: "custom",
        message: "a failed transcript must name its reason",
        path: ["failureReason"],
      });
    }
    if (meeting.status !== "failed" && meeting.failureReason !== null) {
      ctx.addIssue({
        code: "custom",
        message: "a healthy transcript must not carry a failure reason",
        path: ["failureReason"],
      });
    }
    if (meeting.status === "saved" && meeting.durationMinutes === null) {
      ctx.addIssue({
        code: "custom",
        message: "a saved transcript must carry a duration",
        path: ["durationMinutes"],
      });
    }
    if (meeting.status === "recording" && meeting.durationMinutes !== null) {
      ctx.addIssue({
        code: "custom",
        message: "a recording transcript must not carry a duration",
        path: ["durationMinutes"],
      });
    }
    // A row only carries match lines when a search produced it, and a row a
    // search returned always has at least one match. "No matches" and "not
    // searched" must stay distinguishable.
    if (meeting.searched && meeting.matchCount < 1) {
      ctx.addIssue({
        code: "custom",
        message: "a searched row must report at least one match",
        path: ["matchCount"],
      });
    }
    if (!meeting.searched && meeting.matchCount !== 0) {
      ctx.addIssue({
        code: "custom",
        message: "a row that was not searched must not report matches",
        path: ["matchCount"],
      });
    }
    if (meeting.matches.length > meeting.matchCount) {
      ctx.addIssue({
        code: "custom",
        message: "more match lines carried than the reported count",
        path: ["matches"],
      });
    }
  });

export const meetingsPageSchema = z
  .object({
    availability: meetingsAvailabilitySchema.refine(
      (availability) => availability.readOnly,
      "the meetings index is read-only by construction",
    ),
    meetings: z.array(meetingTranscriptSchema).max(MAX_MEETINGS_PAGE),
    total: z.number().int().min(0),
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(MAX_MEETINGS_PAGE),
    hasMore: z.boolean(),
    scanTruncated: z.boolean(),
    filters: z
      .object({
        query: z.string().nullable(),
        from: z.string().nullable(),
        to: z.string().nullable(),
        minMinutes: z.number().int().min(0).nullable(),
        maxMinutes: z.number().int().min(0).nullable(),
      })
      .strict(),
    scanned: z.number().int().min(0),
    searched: z.boolean(),
  })
  .strict()
  .refine(
    (page) => page.meetings.every((meeting) => meeting.searched === page.searched),
    "a row and its page must agree about whether a search ran",
  );

export const meetingReadSchema = z
  .object({
    meeting: meetingTranscriptSchema,
    content: z.string(),
    size: z.number().int().min(0),
    truncated: z.boolean(),
  })
  .strict();

export const meetingAnalysisSchema = z
  .object({
    meeting: meetingTranscriptSchema,
    model: z.literal(MEETINGS_ANALYSIS_MODEL),
    provider: z.literal(MEETINGS_ANALYSIS_PROVIDER),
    harness: z.literal(MEETINGS_ANALYSIS_HARNESS),
    summary: z.string(),
    decisions: z.array(meetingSuggestionSchema),
    actions: z.array(meetingSuggestionSchema),
    openQuestions: z.array(meetingSuggestionSchema),
    discarded: z
      .array(
        z
          .object({
            text: z.string(),
            reason: z.enum(["quote-not-found", "quote-too-short", "empty-text"]),
          })
          .strict(),
      )
      .max(5),
    discardedCount: z.number().int().min(0),
    transcriptTruncated: z.boolean(),
    transcriptChars: z.number().int().min(0),
    durationMs: z.number().int().min(0),
  })
  .strict()
  .refine(
    (analysis) => analysis.discarded.length <= analysis.discardedCount,
    "more discarded suggestions shown than reported",
  );

export const meetingsListInputSchema = z
  .object({
    limit: z.number().int().min(1).max(MAX_MEETINGS_PAGE).optional(),
    offset: z.number().int().min(0).max(1_000_000).optional(),
    // Trimmed and non-empty: an all-whitespace query is refused rather than
    // silently treated as "no search", so "0 results" is never the answer to
    // a question nobody asked.
    query: z
      .string()
      .max(MAX_MEETINGS_QUERY_CHARS)
      .refine((value) => value.trim().length > 0, "a query must not be blank")
      .refine((value) => value === value.trim(), "a query is trimmed before it is sent")
      .optional(),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    minMinutes: z.number().int().min(0).max(44_640).optional(),
    maxMinutes: z.number().int().min(0).max(44_640).optional(),
  })
  .strict()
  .refine(
    (input) => input.from === undefined || input.to === undefined || input.from <= input.to,
    "the date range must not be reversed",
  )
  .refine(
    (input) =>
      input.minMinutes === undefined ||
      input.maxMinutes === undefined ||
      input.minMinutes <= input.maxMinutes,
    "the duration range must not be reversed",
  )
  .optional();

export const meetingsAnalyzeInputSchema = z
  .object({
    id: z.string().min(1).max(16_384),
  })
  .strict();

export const meetingCommitmentsQuerySchema = z
  .object({
    status: z.enum(["open", "done", "dismissed"]).optional(),
    open: z.boolean().optional(),
    query: z
      .string()
      .max(MAX_MEETINGS_QUERY_CHARS)
      .refine((value) => value.trim().length > 0, "a query must not be blank")
      .optional(),
    limit: z.number().int().min(1).max(MAX_COMMITMENT_PAGE).optional(),
    offset: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict()
  .optional();

export const meetingCommitmentCreateInputSchema = z
  .object({
    meetingId: z.string().min(1).max(16_384),
    text: z.string().min(1).max(MAX_COMMITMENT_TEXT_CHARS),
    // The quote is what makes the entry checkable; the daemon re-verifies it
    // against the note, and this bound stops a client from sending the whole
    // transcript as "evidence".
    quote: z.string().min(MIN_COMMITMENT_QUOTE_CHARS).max(2_000),
    owner: z.string().min(1).max(120).optional(),
    source: z.enum(["suggested", "owner"]),
    confidence: z.enum(["high", "low"]).optional(),
  })
  .strict();

export const meetingCommitmentUpdateInputSchema = z
  .object({
    id: z.string().min(1).max(200),
    status: z.enum(["open", "done", "dismissed"]),
  })
  .strict();

export const meetingsReadInputSchema = z
  .object({
    id: z.string().min(1).max(16_384),
    maxBytes: z.number().int().min(1).max(MAX_TRANSCRIPT_BYTES).optional(),
  })
  .strict();

export type MeetingsRequest =
  | { op: "list"; params: z.infer<typeof meetingsListInputSchema> }
  | { op: "read"; params: z.infer<typeof meetingsReadInputSchema> }
  | { op: "analyze"; params: z.infer<typeof meetingsAnalyzeInputSchema> }
  | { op: "commitments"; params: z.infer<typeof meetingCommitmentsQuerySchema> }
  | { op: "accept"; params: z.infer<typeof meetingCommitmentCreateInputSchema> }
  | { op: "resolve"; params: z.infer<typeof meetingCommitmentUpdateInputSchema> };

export const meetingsRequestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("list"),
    params: meetingsListInputSchema,
  }),
  z.object({
    op: z.literal("read"),
    params: meetingsReadInputSchema,
  }),
  z.object({
    op: z.literal("analyze"),
    params: meetingsAnalyzeInputSchema,
  }),
  z.object({
    op: z.literal("commitments"),
    params: meetingCommitmentsQuerySchema,
  }),
  z.object({
    op: z.literal("accept"),
    params: meetingCommitmentCreateInputSchema,
  }),
  z.object({
    op: z.literal("resolve"),
    params: meetingCommitmentUpdateInputSchema,
  }),
]);
