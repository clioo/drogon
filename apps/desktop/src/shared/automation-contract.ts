// Standalone automation (journey J7) bridge contract: renderer-facing
// types, zod validation for main-side admission, and the AutomationBridge
// interface the preload exposes as `window.drogon.automation.*`. Shapes
// follow the daemon's `automation.*` wire projections (camelCase).

import { z } from "zod";
import type { Result } from "./session-contract";
import type { DesktopBridge } from "./session-contract";

export const AUTOMATION_CAPABILITY = "automation.v1";

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\x00-\x1f\x7f]+$/);
const text = (max: number) => z.string().max(max);
const cron = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\x00-\x1f\x7f]+$/);
const harnessId = z.enum(["claude", "pi", "opencode", "antigravity", "codex"]);
// IANA timezone admission: "UTC" plus any zone the host Intl database
// resolves. The daemon re-validates against its own tz database and
// rejects unknown zones instead of silently treating them as UTC.
const timezone = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[^\x00-\x1f\x7f]+$/)
  .refine(
    (value) => {
      if (value === "UTC") return true;
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: "must be a valid IANA timezone" },
  );
// Pinned harness model/provider override (additive): the daemon stores and
// launches with these when present; absent means the harness default.
const harnessOption = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[^\x00-\x1f\x7f]+$/)
  .refine((value) => !value.startsWith("-"), {
    message: "must not be flag-shaped",
  });

export type AutomationCreateInput = {
  name: string;
  cron: string;
  timezone?: string;
  workspaceId: string;
  harness: "claude" | "pi" | "opencode" | "antigravity" | "codex";
  prompt: string;
  enabled?: boolean;
  graceMinutes?: number;
  model?: string;
  provider?: string;
};

export type AutomationUpdateInput = {
  id: string;
  name?: string;
  cron?: string;
  timezone?: string;
  workspaceId?: string;
  harness?: "claude" | "pi" | "opencode" | "antigravity" | "codex";
  prompt?: string;
  enabled?: boolean;
  graceMinutes?: number;
  model?: string;
  provider?: string;
};

export type AutomationLastRun = {
  id: string;
  status: string;
  trigger: string;
  scheduledFor: number;
  error: string | null;
  exitCode: number | null;
};

export type AutomationSummary = {
  id: string;
  name: string;
  cron: string;
  /** IANA zone the cron wall time evaluates in; absent means legacy UTC. */
  timezone?: string;
  workspaceId: string | null;
  harness: string;
  model?: string;
  provider?: string;
  prompt: string;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt: number | null;
  lastRun: AutomationLastRun | null;
};

export type AutomationRunView = {
  id: string;
  automationId: string;
  status: string;
  trigger: string;
  scheduledFor: number;
  workspaceId: string | null;
  terminalSessionId: string | null;
  error: string | null;
  exitCode: number | null;
  startedAt: number | null;
  dispatchedAt: number | null;
  createdAt: number;
};

export type AutomationPreviewSkipped = {
  /** Local calendar date with no fire, e.g. "2026-03-08". */
  date: string;
  /** Local wall time that does not exist, e.g. "02:30". */
  wallTime: string;
  reason: string;
};

export type AutomationPreviewResult = {
  /** Effective zone the preview evaluated in. */
  timezone: string;
  /** Next UTC fire instants (ms epoch), strictly after fromMs. */
  fires: number[];
  /** Fixed-time slots skipped as nonexistent local times (DST gaps). */
  skipped: AutomationPreviewSkipped[];
};

export type AutomationRunNowResult = {
  automationId: string;
  runId: string | null;
  outcome: "dispatched" | "refused";
  status: string | null;
  refusal: string | null;
  error: string | null;
};

/** One runs-dashboard row: a run plus its owning automation's name. */
export type AutomationRunListItem = AutomationRunView & {
  title: string;
  automationName: string;
};

export type AutomationRunsAllResult = {
  runs: AutomationRunListItem[];
  page: number;
  perPage: number;
  total: number;
};

export type AutomationRunOutputSnapshot = {
  format: "plain_text";
  content: string;
  capturedAt: number;
  truncated: boolean;
};

/** `automation.run` detail for the run page. */
export type AutomationRunDetail = AutomationRunView & {
  title: string;
  workspaceDisplayName: string | null;
  outputSnapshot: AutomationRunOutputSnapshot | null;
  /** Whether the run's terminal session is still known to the daemon. */
  sessionExists: boolean;
};

export interface AutomationBridge {
  list(): Promise<Result<{ automations: AutomationSummary[] }>>;
  create(input: AutomationCreateInput): Promise<Result<AutomationSummary>>;
  update(input: AutomationUpdateInput): Promise<Result<AutomationSummary>>;
  remove(input: { id: string }): Promise<Result<{ id: string }>>;
  runNow(input: { id: string }): Promise<Result<AutomationRunNowResult>>;
  history(input: {
    automationId: string;
    limit?: number;
  }): Promise<Result<{ runs: AutomationRunView[] }>>;
  runsAll(input: {
    page: number;
    perPage: number;
    status?: string;
  }): Promise<Result<AutomationRunsAllResult>>;
  run(input: { runId: string }): Promise<Result<AutomationRunDetail>>;
  preview(input: {
    cron: string;
    timezone?: string;
    fromMs?: number;
    count?: number;
  }): Promise<Result<AutomationPreviewResult>>;
}

// Renderer request envelope for the single `drogon:automation` IPC
// channel: the op selects the native `automation.*` method.
export const automationRequestSchema = z.object({
  op: z.enum([
    "create",
    "list",
    "update",
    "delete",
    "runNow",
    "history",
    "runsAll",
    "run",
    "preview",
  ]),
  params: z.record(z.string(), z.unknown()).default({}),
});

// Renderer-side input validation (main re-validates before the native
// call; this fails fast in the panel).
export const automationInputSchemas = {
  create: z.object({
    name: z.string().min(1).max(128),
    cron,
    timezone: timezone.optional(),
    workspaceId: id,
    harness: harnessId,
    prompt: text(32768).refine((value) => value.trim().length > 0),
    enabled: z.boolean().optional(),
    graceMinutes: z.number().min(0).max(10_080).optional(),
    model: harnessOption.optional(),
    provider: harnessOption.optional(),
  }),
  update: z.object({
    id,
    name: z.string().min(1).max(128).optional(),
    cron: cron.optional(),
    timezone: timezone.optional(),
    workspaceId: id.optional(),
    harness: harnessId.optional(),
    prompt: text(32768)
      .refine((value) => value.trim().length > 0)
      .optional(),
    enabled: z.boolean().optional(),
    graceMinutes: z.number().min(0).max(10_080).optional(),
    model: harnessOption.optional(),
    provider: harnessOption.optional(),
  }),
  delete: z.object({ id }),
  runNow: z.object({ id }),
  history: z.object({
    automationId: id,
    limit: z.number().int().min(1).max(200).optional(),
  }),
  runsAll: z.object({
    page: z.number().int().min(1),
    perPage: z.number().int().min(1).max(200),
    status: z
      .enum([
        "pending",
        "dispatching",
        "dispatched",
        "completed",
        "skipped_precheck",
        "skipped_missed",
        "skipped_unavailable",
        "skipped_needs_interactive_auth",
        "dispatch_failed",
      ])
      .optional(),
  }),
  run: z.object({ runId: id }),
  preview: z.object({
    cron,
    timezone: timezone.optional(),
    fromMs: z.number().finite().nonnegative().optional(),
    count: z.number().int().min(1).max(10).optional(),
  }),
  list: z.object({}),
};

const lastRunSchema = z.object({
  id: z.string(),
  status: z.string(),
  trigger: z.string(),
  scheduledFor: z.number(),
  error: z.string().nullable(),
  exitCode: z.number().nullable(),
});

const summarySchema = z.object({
  id: z.string(),
  name: z.string(),
  cron: z.string(),
  timezone: z.string().optional(),
  workspaceId: z.string().nullable(),
  harness: z.string(),
  model: z.string().optional(),
  provider: z.string().optional(),
  prompt: z.string(),
  enabled: z.boolean(),
  nextRunAt: z.number(),
  lastRunAt: z.number().nullable(),
  lastRun: lastRunSchema.nullable(),
});

const runViewSchema = z.object({
  id: z.string(),
  automationId: z.string(),
  status: z.string(),
  trigger: z.string(),
  scheduledFor: z.number(),
  workspaceId: z.string().nullable(),
  terminalSessionId: z.string().nullable(),
  error: z.string().nullable(),
  exitCode: z.number().nullable(),
  startedAt: z.number().nullable(),
  dispatchedAt: z.number().nullable(),
  createdAt: z.number(),
});

const outputSnapshotSchema = z.object({
  format: z.literal("plain_text"),
  content: z.string(),
  capturedAt: z.number(),
  truncated: z.boolean(),
});

const previewSkippedSchema = z.object({
  date: z.string(),
  wallTime: z.string(),
  reason: z.string(),
});

// Native result validation (main side, after the RPC round trip).
export const automationResultSchemas = {
  "automation.create": summarySchema,
  "automation.list": z.object({ automations: z.array(summarySchema) }),
  "automation.update": summarySchema,
  "automation.delete": z.object({ id: z.string() }),
  "automation.run_now": z.object({
    automationId: z.string(),
    runId: z.string().nullable(),
    outcome: z.enum(["dispatched", "refused"]),
    status: z.string().nullable(),
    refusal: z.string().nullable(),
    error: z.string().nullable(),
  }),
  "automation.history": z.object({ runs: z.array(runViewSchema) }),
  "automation.runs_all": z.object({
    runs: z.array(
      runViewSchema.and(
        z.object({
          title: z.string(),
          automationName: z.string(),
        }),
      ),
    ),
    page: z.number(),
    perPage: z.number(),
    total: z.number(),
  }),
  "automation.run": runViewSchema.and(
    z.object({
      title: z.string(),
      workspaceDisplayName: z.string().nullable().optional(),
      outputSnapshot: outputSnapshotSchema.nullable(),
      sessionExists: z.boolean(),
    }),
  ),
  "automation.preview": z.object({
    timezone: z.string(),
    fires: z.array(z.number()),
    skipped: z.array(previewSkippedSchema),
  }),
};

declare module "./session-contract" {
  interface DesktopBridge {
    automation: AutomationBridge;
  }
}
