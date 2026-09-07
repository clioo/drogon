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
const harnessId = z.enum(["claude", "pi", "opencode", "antigravity"]);

export type AutomationCreateInput = {
  name: string;
  cron: string;
  workspaceId: string;
  harness: "claude" | "pi" | "opencode" | "antigravity";
  prompt: string;
  enabled?: boolean;
  graceMinutes?: number;
};

export type AutomationUpdateInput = {
  id: string;
  name?: string;
  cron?: string;
  workspaceId?: string;
  harness?: "claude" | "pi" | "opencode" | "antigravity";
  prompt?: string;
  enabled?: boolean;
  graceMinutes?: number;
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
  workspaceId: string | null;
  harness: string;
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

export type AutomationRunNowResult = {
  automationId: string;
  runId: string | null;
  outcome: "dispatched" | "refused";
  status: string | null;
  refusal: string | null;
  error: string | null;
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
}

// Renderer request envelope for the single `drogon:automation` IPC
// channel: the op selects the native `automation.*` method.
export const automationRequestSchema = z.object({
  op: z.enum(["create", "list", "update", "delete", "runNow", "history"]),
  params: z.record(z.string(), z.unknown()).default({}),
});

// Renderer-side input validation (main re-validates before the native
// call; this fails fast in the panel).
export const automationInputSchemas = {
  create: z.object({
    name: z.string().min(1).max(128),
    cron,
    workspaceId: id,
    harness: harnessId,
    prompt: text(32768).refine((value) => value.trim().length > 0),
    enabled: z.boolean().optional(),
    graceMinutes: z.number().min(0).max(10_080).optional(),
  }),
  update: z.object({
    id,
    name: z.string().min(1).max(128).optional(),
    cron: cron.optional(),
    workspaceId: id.optional(),
    harness: harnessId.optional(),
    prompt: text(32768)
      .refine((value) => value.trim().length > 0)
      .optional(),
    enabled: z.boolean().optional(),
    graceMinutes: z.number().min(0).max(10_080).optional(),
  }),
  delete: z.object({ id }),
  runNow: z.object({ id }),
  history: z.object({
    automationId: id,
    limit: z.number().int().min(1).max(200).optional(),
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
  workspaceId: z.string().nullable(),
  harness: z.string(),
  prompt: z.string(),
  enabled: z.boolean(),
  nextRunAt: z.number(),
  lastRunAt: z.number().nullable(),
  lastRun: lastRunSchema.nullable(),
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
  "automation.history": z.object({
    runs: z.array(
      z.object({
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
      }),
    ),
  }),
};

declare module "./session-contract" {
  interface DesktopBridge {
    automation: AutomationBridge;
  }
}
