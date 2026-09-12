// Work-graph contract (renderer display contract for `<workspace>/.drogon/graph.json`,
// version 1). This mirrors the daemon's serde projection in
// `crates/drogon-protocol/src/graph.rs` (landed in PR #444) EXACTLY at the
// ownership seam:
//
//   - `intent`  — written ONLY by the human (through the UI) and, later, by an
//                 agent planning its own work. The daemon NEVER writes here.
//   - `state`   — written ONLY by the daemon/coordinator from REAL observation.
//                 The UI NEVER writes here (phase 1 of the work graph is
//                 read-only; no code path in features/work-graph writes state).
//
// A node is `running` only when the backend confirms a live process; loss of
// contact is `unverifiable`, never silently failed or succeeded. This module
// only PARSES what the daemon observed — it never projects, estimates or
// invents a value the file does not carry.
//
// Parsing is intentionally lenient where the contract is open (`evidence` is
// `Option<Value>` on the daemon and currently embeds the run-record step, so
// unknown keys are preserved verbatim for display instead of dropped), and
// strict where the contract is closed (top-level shape, ownership sections,
// version).

import { z } from "zod";

export const WORK_GRAPH_VERSION = 1;

/** The workspace-relative file this view renders. */
export const WORK_GRAPH_RELATIVE_PATH = ".drogon/graph.json";

/** Every status the daemon may observe for a node (`GraphNodeStatus`).
 *  `unverifiable` is a first-class outcome (loss of contact), never folded
 *  into failed; `blocked` means not runnable in this graph (disabled, or an
 *  upstream failure) — also never a loss-of-contact claim. */
export const WORK_GRAPH_STATUSES = [
  "idle",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "unverifiable",
] as const;
export type WorkGraphStatus = (typeof WORK_GRAPH_STATUSES)[number];

/** Shell vs agent is a property of the node's harness: the contract's shell
 *  backend runs a local command (no model — its model field is the EMPTY
 *  string, and token/cost metrics are NOT APPLICABLE there, never
 *  "unavailable"); every other harness is an agent node whose usage is
 *  reported or honestly unavailable. */
export const WORK_GRAPH_SHELL_HARNESS = "shell";

export function isShellHarness(harness: string): boolean {
  return harness === WORK_GRAPH_SHELL_HARNESS;
}

/** Additive Pi provider binding inputs (the daemon refuses to compile a
 *  `pi` node without them). */
export type WorkGraphProvider = {
  baseUrl: string;
  apiKeyEnv: string;
};

// The node/doc types are DERIVED from the schemas so the parse rules and
// the shape can never drift apart. See each schema for the honesty notes.

/** One intent node: what the human wants — the daemon's `GraphNodeIntent`
 *  (camelCase on the wire). `model` is the exact model id or the EMPTY
 *  string for shell / harness default; the daemon never writes null. */
export type WorkGraphIntentNode = z.infer<typeof workGraphIntentNodeSchema>;

/** The evidence one node produced. The daemon writes
 *  `{ runId, mentuRunId, step }` where `step` is the run-record step; the
 *  shape stays open (`Option<Value>` daemon-side), so unknown keys ride
 *  through and the view spells them out — never silently drops them. */
export type WorkGraphEvidence = z.infer<typeof workGraphEvidenceSchema>;

export type WorkGraphEvidenceStep = z.infer<typeof evidenceStepSchema>;

export type WorkGraphStepUsage = z.infer<typeof stepUsageSchema>;

/** One state node: what the daemon OBSERVED (`GraphNodeState`). Written
 *  only by the daemon. */
export type WorkGraphStateNode = z.infer<typeof workGraphStateNodeSchema>;

export type WorkGraphDocument = z.infer<typeof workGraphDocumentSchema>;

// ---------------------------------------------------------------------------
// zod schemas (lenient on unknown evidence/state keys, strict on the seam)
// ---------------------------------------------------------------------------

const isoText = z.string().min(1);
const idText = z.string().min(1).max(200);

export const workGraphIntentNodeSchema = z.object({
  id: idText,
  title: z.string().min(1).max(500),
  harness: z.string().min(1).max(200),
  /** Empty string = shell / harness default; the daemon never writes null. */
  model: z.string().max(500).optional().default(""),
  dependsOn: z.array(z.string().min(1).max(200)).optional().default([]),
  prompt: z.string().max(100_000).optional().default(""),
  enabled: z.boolean().optional().default(true),
  verifyCommands: z.array(z.string().min(1).max(65_536)).optional(),
  provider: z
    .object({ baseUrl: z.string().min(1), apiKeyEnv: z.string().min(1) })
    .optional(),
  /** The DESIGNER's canvas coordinates (the graph-canvas authoring surface).
   *  Deliberately not part of the daemon's `GraphNodeIntent`: the store
   *  preserves unknown node fields verbatim, so the daemon carries the
   *  designer's layout without understanding it. Pure display, never
   *  execution semantics. */
  position: z
    .object({ x: z.number().finite(), y: z.number().finite() })
    .optional(),
});

const stepUsageSchema = z
  .object({
    inputTokens: z.number().nullable().optional(),
    outputTokens: z.number().nullable().optional(),
    usageKnown: z.boolean().nullable().optional(),
    invalid: z
      .array(z.object({ field: z.string(), reason: z.string() }).passthrough())
      .optional(),
  })
  .passthrough();

const evidenceStepSchema = z
  .object({
    label: z.string().min(1),
    backend: z.string().min(1),
    status: z.string().min(1),
    exitCode: z.number().int().nullable().optional(),
    durationSeconds: z.number().nullable().optional(),
    attempts: z.number().int().nullable().optional(),
    outputPath: z.string().nullable().optional(),
    errorPath: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    usage: stepUsageSchema.nullable().optional(),
  })
  .passthrough();

export const workGraphEvidenceSchema = z
  .object({
    runId: z.string().nullable().optional(),
    mentuRunId: z.string().nullable().optional(),
    step: evidenceStepSchema.nullable().optional(),
    drift: z
      .object({
        expected: z.array(z.string()).optional().default([]),
        created: z.array(z.string()).optional().default([]),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export const workGraphStateNodeSchema = z
  .object({
    id: idText,
    status: z.enum(WORK_GRAPH_STATUSES),
    runId: z.string().nullable().optional(),
    mentuRunId: z.string().nullable().optional(),
    startedAt: isoText.nullable().optional(),
    endedAt: isoText.nullable().optional(),
    evidence: workGraphEvidenceSchema.nullable().optional(),
    lastError: z.string().nullable().optional(),
    /** F0: which runtime ACTUALLY ran this node's latest launch (the
     *  failover-substituted candidate, or the node's own authored
     *  harness/model when nothing was substituted) — absent only when the
     *  daemon predates this field or the node has never launched. */
    harness: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    isFreeDefaultRuntime: z.boolean().nullable().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Subagent policy (mirrors `GraphPolicy`/`GraphRuntimeRef`/
// `GraphAdversarialPolicy` in `crates/drogon-protocol/src/graph.rs` exactly).
// Lives here, not in `graph-contract.ts` (the write/authoring seam), so the
// read-only view — which parses raw `.drogon/graph.json` bytes through THIS
// module alone, with no dependency on `graph-contract.ts` — can also see
// it; `graph-contract.ts` re-exports everything below unchanged.
//
// This section is additive on the daemon's `GraphIntent` and, on the write
// side, deliberately absent from the store's known-intent-key set (see the
// Rust doc comment on `GraphIntent::policy`): a `graph.write_intent` payload
// that omits `policy` entirely (e.g. the authoring canvas saving a node
// edit) must leave whatever policy is already on disk untouched. The panel
// that EDITS policy must therefore always resend the current `nodes` array
// unchanged alongside its policy edit, exactly as the designer already does
// for node edits today.
// ---------------------------------------------------------------------------

export const MIN_ADVERSARIAL_MAX_ITERATIONS = 1;
export const MAX_ADVERSARIAL_MAX_ITERATIONS = 10;
export const DEFAULT_ADVERSARIAL_MAX_ITERATIONS = 3;
export const MAX_POLICY_APPROVED_RUNTIMES = 32;
/** The adversarial loop always contributes exactly two role nodes to the
 *  canvas when enabled: Adversarial test and Code review (Part 2). Typed
 *  `number`, not the literal `2`, so `deriveSubagentPolicySummary`'s
 *  singular/plural check stays real type-checked code instead of TS
 *  narrowing it to an "unreachable" comparison. */
export const ADVERSARIAL_OPTIONAL_SUBAGENT_COUNT: number = 2;

export const graphRuntimeRefSchema = z
  .object({
    harness: z.string().min(1).max(64),
    model: z.string().max(256).optional().default(""),
  })
  .strict();

export type GraphRuntimeRef = z.infer<typeof graphRuntimeRefSchema>;

export const graphAdversarialPolicySchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    maxIterations: z
      .number()
      .int()
      .min(MIN_ADVERSARIAL_MAX_ITERATIONS)
      .max(MAX_ADVERSARIAL_MAX_ITERATIONS)
      .optional()
      .default(DEFAULT_ADVERSARIAL_MAX_ITERATIONS),
  })
  .strict();

export type GraphAdversarialPolicy = z.infer<
  typeof graphAdversarialPolicySchema
>;

export const graphPolicySchema = z
  .object({
    approvedRuntimes: z
      .array(graphRuntimeRefSchema)
      .max(MAX_POLICY_APPROVED_RUNTIMES)
      .optional()
      .default([]),
    fallbackRuntime: graphRuntimeRefSchema.nullable().optional().default(null),
    adversarial: graphAdversarialPolicySchema.optional().default({
      enabled: false,
      maxIterations: DEFAULT_ADVERSARIAL_MAX_ITERATIONS,
    }),
    delegate: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (policy.delegate && policy.adversarial.enabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["delegate"],
        message:
          "Delegate and adversarial testing are mutually exclusive execution modes.",
      });
    }
  });

export type GraphPolicy = z.infer<typeof graphPolicySchema>;

/** "Nothing configured yet" — the same state an intent written before this
 *  field existed parses as, on both sides of the wire. */
export const DEFAULT_GRAPH_POLICY: GraphPolicy = Object.freeze({
  approvedRuntimes: [],
  fallbackRuntime: null,
  adversarial: {
    enabled: false,
    maxIterations: DEFAULT_ADVERSARIAL_MAX_ITERATIONS,
  },
  delegate: false,
});

/** A daemon build that predates this field omits `policy` from `graph.read`
 *  entirely; callers should read policy through this helper rather than
 *  reaching into `intent.policy` directly so that skew never crashes. */
export function resolveGraphPolicy(intent: {
  policy?: GraphPolicy | null;
}): GraphPolicy {
  return intent.policy ?? DEFAULT_GRAPH_POLICY;
}

/** Compact policy summary. The mode is more honest than a fabricated dynamic
 *  worker count: Delegate and Adversarial can create a task-dependent number
 *  of depth-one children, while Direct creates none. */
export function deriveSubagentPolicySummary(policy: GraphPolicy): string {
  const approved = policy.approvedRuntimes.length;
  const fallback = policy.fallbackRuntime ? 1 : 0;
  const mode = policy.adversarial.enabled
    ? "Adversarial · Depth 1"
    : policy.delegate
      ? "Delegate · Depth 1"
      : "Direct";
  return `${approved} approved · ${fallback} fallback · ${mode}`;
}

// ---------------------------------------------------------------------------
// F0: paid/external runtime disclosure. Mirrors
// `crates/drogon-core/src/graph/failover.rs`'s `default_free_runtime`/
// `attempt_sequence` exactly (a read-only TS mirror of that Rust logic, not
// a shared implementation — kept in sync by hand, same as this whole
// section already mirrors `GraphPolicy`). The daemon's OWN attribution
// (`WorkGraphStateNode.isFreeDefaultRuntime`, once a node has launched) is
// the authoritative source once it exists; this policy-level mirror is for
// disclosure BEFORE anything launches, when there is nothing to observe yet.
// ---------------------------------------------------------------------------

/** The free, local runtime this build may always run for real without a
 *  human approving it per call — the exact pair `default_free_runtime()`
 *  returns. */
export const FREE_DEFAULT_RUNTIME: GraphRuntimeRef = Object.freeze({
  harness: "pi",
  model: "qwen3.8-flash-next-nvidia-nvfp4",
});

export function isFreeDefaultRuntime(runtime: GraphRuntimeRef): boolean {
  return (
    runtime.harness === FREE_DEFAULT_RUNTIME.harness &&
    runtime.model === FREE_DEFAULT_RUNTIME.model
  );
}

/** The full ordered attempt sequence a failover episode would try for any
 *  node this policy governs — mirrors `failover::attempt_sequence` exactly. */
export function policyAttemptSequence(policy: GraphPolicy): GraphRuntimeRef[] {
  const sequence =
    policy.approvedRuntimes.length > 0
      ? [...policy.approvedRuntimes]
      : [FREE_DEFAULT_RUNTIME];
  return policy.fallbackRuntime
    ? [...sequence, policy.fallbackRuntime]
    : sequence;
}

/** The FIRST runtime a "Run workflow" governed by this policy would try —
 *  the one fact the canvas needs to disclose before anything launches. */
export function policyFirstRuntime(policy: GraphPolicy): GraphRuntimeRef {
  return policyAttemptSequence(policy)[0] ?? FREE_DEFAULT_RUNTIME;
}

/** F0: whether ANY candidate this policy could ever launch is not the free
 *  local default — i.e., whether a run this policy governs could spawn
 *  paid/external inference at some point in its failover episode. */
export function policyMayRunPaidRuntime(policy: GraphPolicy): boolean {
  return policyAttemptSequence(policy).some(
    (runtime) => !isFreeDefaultRuntime(runtime),
  );
}

const intentSection = z.object({
  nodes: z.array(workGraphIntentNodeSchema),
  // Optional: an older daemon build (or a raw file written before this field
  // existed) omits it entirely. Read through `resolveGraphPolicy` so that
  // skew never crashes the renderer.
  policy: graphPolicySchema.optional(),
});
const stateSection = z.object({
  updatedAt: isoText,
  nodes: z.array(workGraphStateNodeSchema),
});

export const workGraphDocumentSchema = z.object({
  version: z.literal(WORK_GRAPH_VERSION),
  intent: intentSection,
  state: stateSection,
});

/** Every way reading the graph file can fail, spelled out for the UI. */
export type WorkGraphReadFailure =
  | { kind: "not_json"; message: string }
  | { kind: "unsupported_version"; version: unknown; message: string }
  | { kind: "invalid"; message: string };

export type WorkGraphParseResult =
  | { ok: true; document: WorkGraphDocument }
  | { ok: false; failure: WorkGraphReadFailure };

/** Parse the exact bytes of `.drogon/graph.json`. Never throws: a malformed
 *  graph renders an honest refusal, never an empty or half story. */
export function parseWorkGraphDocument(raw: string): WorkGraphParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      failure: {
        kind: "not_json",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  if (
    json !== null &&
    typeof json === "object" &&
    "version" in json &&
    (json as { version?: unknown }).version !== WORK_GRAPH_VERSION
  ) {
    return {
      ok: false,
      failure: {
        kind: "unsupported_version",
        version: (json as { version?: unknown }).version,
        message: `This build renders work-graph version ${WORK_GRAPH_VERSION}; the file declares version ${JSON.stringify(
          (json as { version?: unknown }).version,
        )}.`,
      },
    };
  }
  const parsed = workGraphDocumentSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? issue.path.join(".") : "document";
    return {
      ok: false,
      failure: {
        kind: "invalid",
        message: issue
          ? `${where}: ${issue.message}`
          : "structurally invalid graph",
      },
    };
  }
  return { ok: true, document: parsed.data };
}

/** The state entry the daemon recorded for one intent node, or null when
 *  the daemon has never observed it (the view then shows the node as
 *  not-yet-started, which the contract spells `idle`). */
export function stateNodeFor(
  document: WorkGraphDocument,
  nodeId: string,
): WorkGraphStateNode | null {
  return document.state.nodes.find((node) => node.id === nodeId) ?? null;
}

/** The node's model id as displayed: the exact id, or null when the field
 *  is empty (shell / harness default). */
export function intentModel(node: { model: string }): string | null {
  return node.model.length > 0 ? node.model : null;
}
