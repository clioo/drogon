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
export const DEFAULT_MEETINGS_PAGE = 50;
export const MAX_MEETINGS_PAGE = 200;
/** Write That Down's own per-transcript cap. */
export const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;

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
};

export type MeetingRead = {
  meeting: MeetingTranscript;
  content: string;
  size: number;
  /** `content` is a complete prefix, cut on a UTF-8 boundary. */
  truncated: boolean;
};

export interface MeetingsBridge {
  list(input?: {
    limit?: number;
    offset?: number;
  }): Promise<Result<MeetingsPage>>;
  read(input: {
    id: string;
    maxBytes?: number;
  }): Promise<Result<MeetingRead>>;
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
  })
  .strict();

export const meetingReadSchema = z
  .object({
    meeting: meetingTranscriptSchema,
    content: z.string(),
    size: z.number().int().min(0),
    truncated: z.boolean(),
  })
  .strict();

export const meetingsListInputSchema = z
  .object({
    limit: z.number().int().min(1).max(MAX_MEETINGS_PAGE).optional(),
    offset: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict()
  .optional();

export const meetingsReadInputSchema = z
  .object({
    id: z.string().min(1).max(16_384),
    maxBytes: z.number().int().min(1).max(MAX_TRANSCRIPT_BYTES).optional(),
  })
  .strict();

export type MeetingsRequest =
  | { op: "list"; params: z.infer<typeof meetingsListInputSchema> }
  | { op: "read"; params: z.infer<typeof meetingsReadInputSchema> };

export const meetingsRequestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("list"),
    params: meetingsListInputSchema,
  }),
  z.object({
    op: z.literal("read"),
    params: meetingsReadInputSchema,
  }),
]);
