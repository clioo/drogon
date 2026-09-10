// Mentu (journey J9) contract: workspace recipes, a content-bound approval,
// execution through the pinned `mentu-recipes` runtime, run evidence and
// retry. Shapes mirror the serde camelCase JSON projections of
// `crates/drogon-protocol/src/mentu.rs`. This is the panel/tab's own
// display contract, not a second storage authority.

import { z } from "zod";
import type { Result } from "./session-contract";

export const MENTU_CAPABILITY = "mentu.v1";

export type MentuRunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unavailable";

export type MentuRecipeSummary = {
  id: string;
  path: string;
  name: string | null;
  valid: boolean;
  issue: string | null;
};

export type MentuStep = {
  label: string;
  backend: string;
  description: string | null;
  dependsOn: string[];
  timeoutSeconds: number | null;
  /** The step's declared `verify.commands`, when the recipe defines any. */
  verifyCommands: string[];
};

export type MentuRecipeDetail = {
  id: string;
  path: string;
  name: string;
  description: string | null;
  contentHash: string;
  steps: MentuStep[];
  source: string;
};

export type MentuRuntimeInfo = {
  available: boolean;
  path: string | null;
  version: string | null;
  expectedRevision: string;
  expectedSha256: string;
  actualSha256: string | null;
  lockMatches: boolean;
  message: string | null;
};

export type MentuApproval = {
  id: string;
  workspaceId: string;
  recipeId: string;
  contentHash: string;
  approvedAt: string;
};

export type MentuStepVerification = {
  errors: string[];
  warnings: string[];
};

/** Why one recorded usage value is not a usable measurement. */
export type MentuUsageInvalidReason =
  | "not_a_number"
  | "not_an_integer"
  | "negative"
  | "not_finite"
  | "out_of_range";

/** One rejected usage field: the run-record key exactly as written there
 *  (e.g. `input_tokens`) and why its value was rejected. */
export type MentuUsageIssue = {
  field: string;
  reason: MentuUsageInvalidReason;
};

/** The usage one run-record step entry observed, mirroring the daemon's
 *  `MentuStepUsage` (`crates/drogon-protocol/src/mentu.rs`). A recorded 0
 *  is a genuine measured zero only under `usageKnown: true`; rejected
 *  values are marked in `invalid`, never silently dropped, never summed.
 *  Null (and an absent `usage` on the step) means honestly unavailable. */
export type MentuStepUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  usageKnown: boolean | null;
  invalid: MentuUsageIssue[];
};

export type MentuStepRun = {
  label: string;
  backend: string;
  status: MentuRunStatus;
  exitCode: number | null;
  durationSeconds: number | null;
  attempts: number | null;
  outputPath: string | null;
  errorPath: string | null;
  error: string | null;
  /** Recorded verification results; null when the run record carries none. */
  verification: MentuStepVerification | null;
  /** The model the runtime recorded for this entry, when a string. */
  model?: string | null;
  /** Observed usage; null/absent when the record carries none. */
  usage?: MentuStepUsage | null;
};

export type MentuRun = {
  id: string;
  workspaceId: string;
  recipeId: string;
  approvalId: string;
  mentuRunId: string | null;
  status: MentuRunStatus;
  startedAt: string;
  endedAt: string | null;
  steps: MentuStepRun[];
  error: string | null;
  retryOf: string | null;
};

/** One captured stdio stream for a step, mirroring the daemon wire shape
 *  (`crates/drogon-protocol/src/mentu.rs`, ported from the fork's
 *  `MentuReferencedOutput`): `reference` is the file name the run record
 *  carries, `path` the absolute path resolved inside the run directory,
 *  `content` the head of its UTF-8 text. `error` is `content_truncated`
 *  when the stream was cut at the daemon cap, or a read failure reason. */
export type MentuReferencedOutput = {
  reference: string;
  path: string | null;
  content: string | null;
  error: string | null;
};

/** One step label's captured streams; the newest attempt record wins. */
export type MentuStepEvidence = {
  label: string;
  stdout: MentuReferencedOutput;
  stderr: MentuReferencedOutput;
};

export type MentuRunEvidenceResult = {
  runId: string;
  mentuRunId: string | null;
  evidence: MentuStepEvidence[];
};

export type MentuRecipesResult = { recipes: MentuRecipeSummary[] };
export type MentuRecipeResult = { recipe: MentuRecipeDetail };
export type MentuRecipeSaveResult = { recipe: MentuRecipeDetail };
export type MentuRuntimeResult = { runtime: MentuRuntimeInfo };
export type MentuApproveResult = { approval: MentuApproval };
export type MentuRunResult = { run: MentuRun };
export type MentuRunsResult = { runs: MentuRun[] };

export interface MentuBridge {
  mentuRecipes(input: { workspaceId: string }): Promise<Result<MentuRecipesResult>>;
  mentuRecipe(input: {
    workspaceId: string;
    recipeId: string;
  }): Promise<Result<MentuRecipeResult>>;
  // Optional so older preload builds still satisfy the interface; the
  // tab disables saving when it is absent.
  mentuRecipeSave?: (input: {
    workspaceId: string;
    recipeId: string;
    content: string;
  }) => Promise<Result<MentuRecipeSaveResult>>;
  mentuRuntime(): Promise<Result<MentuRuntimeResult>>;
  mentuApprove(input: {
    workspaceId: string;
    recipeId: string;
    contentHash: string;
  }): Promise<Result<MentuApproveResult>>;
  mentuRun(input: {
    workspaceId: string;
    recipeId: string;
    approvalId: string;
  }): Promise<Result<MentuRunResult>>;
  mentuRuns(input: {
    workspaceId: string;
    limit?: number;
  }): Promise<Result<MentuRunsResult>>;
  mentuRunStatus(input: { runId: string }): Promise<Result<MentuRunResult>>;
  // Optional so older preload builds still satisfy the interface; the
  // evidence view falls back to path-only rows when it is absent (the same
  // precedent as `mentuRecipeSave` above).
  mentuRunEvidence?: (input: {
    runId: string;
  }) => Promise<Result<MentuRunEvidenceResult>>;
  mentuRetry(input: { runId: string }): Promise<Result<MentuRunResult>>;
  mentuCancel(input: { runId: string }): Promise<Result<MentuRunResult>>;
  /**
   * Additive (Mentu-as-tab): `drogon-cli mentu open` arrives in the
   * renderer as one main -> renderer request; the shell opens (or focuses)
   * the workspace's Mentu tab and answers through
   * {@link MentuBridge.reportOpenTab}. Optional so older preload builds
   * still satisfy the interface — the CLI then gets an honest
   * `mentu_open_unsupported` refusal instead of silence.
   */
  onOpenTab?: (listener: (request: MentuOpenTabRequest) => void) => () => void;
  reportOpenTab?: (result: MentuOpenTabResult) => Promise<boolean>;
}

/** One `mentu.open` request forwarded from the daemon relay. */
export type MentuOpenTabRequest = {
  requestId: string;
  workspaceId: string;
  recipeId?: string;
};

/** The renderer's own verdict for one `mentu.open` request. `ok: false`
 *  always carries a stable `code` so the CLI can report a refusal rather
 *  than pretend the tab opened. */
export type MentuOpenTabResult = {
  requestId: string;
  ok: boolean;
  /** Present when the workspace did not exist, Mentu was withheld, or the
   *  named recipe is not in the workspace's recipe list. */
  code?: string;
  message?: string;
};

/** Main -> renderer channel carrying one {@link MentuOpenTabRequest}. */
export const MENTU_OPEN_TAB_CHANNEL = "drogon:mentuOpenTab";
/** Renderer -> main channel carrying the {@link MentuOpenTabResult}. */
export const MENTU_OPEN_TAB_RESULT_CHANNEL = "drogon:mentuOpenTabResult";

export const mentuOpenTabRequestSchema = z.object({
  requestId: z.string().min(1).max(128),
  workspaceId: z.string().min(1).max(200),
  recipeId: z.string().min(1).max(200).optional(),
});

export const mentuOpenTabResultSchema = z.object({
  requestId: z.string().min(1).max(128),
  ok: z.boolean(),
  code: z.string().min(1).max(128).optional(),
  message: z.string().min(1).max(2_048).optional(),
});

/**
 * Params of one `mentu.open` relay command (the wire shape
 * `crates/drogon-core/src/desktop_relay_rpc.rs` emits). `recipeId` is
 * optional. Additive: nothing above changes.
 */
export const mentuRelayOpenParamsSchema = z.object({
  workspaceId: z.string().min(1).max(200),
  recipeId: z.string().min(1).max(200).optional(),
});
export type MentuRelayOpenParams = z.infer<typeof mentuRelayOpenParamsSchema>;

const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\s\x00-\x1f\x7f]+$/u);
const workspaceId = z.object({ workspaceId: id });

export const mentuBridgeSchemas = {
  mentuRecipes: workspaceId,
  mentuRecipe: workspaceId.extend({ recipeId: id }),
  mentuRecipeSave: workspaceId.extend({
    recipeId: id,
    content: z.string().min(1).max(1024 * 1024),
  }),
  mentuRuntime: z.object({}),
  mentuApprove: workspaceId.extend({
    recipeId: id,
    contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
  }),
  mentuRun: workspaceId.extend({ recipeId: id, approvalId: id }),
  mentuRuns: workspaceId.extend({ limit: z.number().int().positive().max(200).optional() }),
  mentuRunStatus: z.object({ runId: id }),
  mentuRunEvidence: z.object({ runId: id }),
  mentuRetry: z.object({ runId: id }),
  mentuCancel: z.object({ runId: id }),
};

const status = z.enum([
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "unavailable",
]);
const recipeSummary = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  name: z.string().nullable().optional().default(null),
  valid: z.boolean(),
  issue: z.string().nullable().optional().default(null),
});
const step = z.object({
  label: z.string().min(1),
  backend: z.string().min(1),
  description: z.string().nullable().optional().default(null),
  dependsOn: z.array(z.string()).optional().default([]),
  timeoutSeconds: z.number().nullable().optional().default(null),
  verifyCommands: z.array(z.string()).optional().default([]),
});
const recipeDetail = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional().default(null),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
  steps: z.array(step),
  source: z.string(),
});
const runtimeInstallStatus = z.enum(["installed", "already_installed"]);
const runtimeInfo = z.object({
  available: z.boolean(),
  path: z.string().nullable().optional().default(null),
  version: z.string().nullable().optional().default(null),
  expectedRevision: z.string(),
  expectedSha256: z.string(),
  actualSha256: z.string().nullable().optional().default(null),
  lockMatches: z.boolean(),
  message: z.string().nullable().optional().default(null),
});
const approval = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  recipeId: z.string().min(1),
  contentHash: z.string().min(1),
  approvedAt: z.string().min(1),
});
const stepVerification = z.object({
  errors: z.array(z.string()).optional().default([]),
  warnings: z.array(z.string()).optional().default([]),
});
const usageInvalidReason = z.enum([
  "not_a_number",
  "not_an_integer",
  "negative",
  "not_finite",
  "out_of_range",
]);
const usageIssue = z.object({
  field: z.string().min(1),
  reason: usageInvalidReason,
});
const stepUsage = z.object({
  inputTokens: z.number().int().nonnegative().nullable().optional().default(null),
  outputTokens: z.number().int().nonnegative().nullable().optional().default(null),
  usageKnown: z.boolean().nullable().optional().default(null),
  invalid: z.array(usageIssue).optional().default([]),
});
const stepRun = z.object({
  label: z.string().min(1),
  backend: z.string().min(1),
  status,
  exitCode: z.number().nullable().optional().default(null),
  durationSeconds: z.number().nullable().optional().default(null),
  attempts: z.number().nullable().optional().default(null),
  outputPath: z.string().nullable().optional().default(null),
  errorPath: z.string().nullable().optional().default(null),
  error: z.string().nullable().optional().default(null),
  verification: stepVerification.nullable().optional().default(null),
  model: z.string().nullable().optional().default(null),
  usage: stepUsage.nullable().optional().default(null),
});
const run = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  recipeId: z.string().min(1),
  approvalId: z.string().min(1),
  mentuRunId: z.string().nullable().optional().default(null),
  status,
  startedAt: z.string().min(1),
  endedAt: z.string().nullable().optional().default(null),
  steps: z.array(stepRun),
  error: z.string().nullable().optional().default(null),
  retryOf: z.string().nullable().optional().default(null),
});
const referencedOutput = z.object({
  reference: z.string(),
  path: z.string().nullable().optional().default(null),
  content: z.string().nullable().optional().default(null),
  error: z.string().nullable().optional().default(null),
});
const stepEvidence = z.object({
  label: z.string().min(1),
  stdout: referencedOutput,
  stderr: referencedOutput,
});
const runEvidence = z.object({
  runId: z.string().min(1),
  mentuRunId: z.string().nullable().optional().default(null),
  evidence: z.array(stepEvidence),
});

export const mentuResultSchemas = {
  "mentu.recipes": z.object({ recipes: z.array(recipeSummary) }),
  "mentu.recipe": z.object({ recipe: recipeDetail }),
  "mentu.recipe_save": z.object({ recipe: recipeDetail }),
  "mentu.runtime": z.object({ runtime: runtimeInfo }),
  // Additive (journey J9 fresh-install usability). Not part of `MentuBridge`:
  // called only by the desktop main process's one-time bundled-runtime
  // install (`main/mentu-bridge.ts`), never from the renderer — the fork
  // has no install UI to wire this through (see that file's comment).
  "mentu.runtime_install": z.object({ runtime: runtimeInfo, status: runtimeInstallStatus }),
  "mentu.approve": z.object({ approval }),
  "mentu.run": z.object({ run }),
  "mentu.runs": z.object({ runs: z.array(run) }),
  "mentu.run_status": z.object({ run }),
  "mentu.run_evidence": runEvidence,
  "mentu.retry": z.object({ run }),
  "mentu.cancel": z.object({ run }),
};
