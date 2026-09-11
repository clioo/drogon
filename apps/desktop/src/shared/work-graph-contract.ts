// Work-graph contract (renderer display contract for `<workspace>/.drogon/graph.json`,
// version 1). This mirrors the coordinator-defined shared contract EXACTLY at the
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
// `{ ... }` "or a reference the UI can resolve", so unknown evidence keys are
// preserved verbatim for display instead of dropped), and strict where the
// contract is closed (top-level shape, ownership sections, version).

import { z } from "zod";

export const WORK_GRAPH_VERSION = 1;

/** The workspace-relative file this view renders. */
export const WORK_GRAPH_RELATIVE_PATH = ".drogon/graph.json";

/** Every status the daemon may observe for a node. `unverifiable` is a
 *  first-class outcome (loss of contact), never folded into failed. */
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
 *  steps run a local command (no model, no tokens — token/cost metrics are
 *  NOT APPLICABLE there, never "unavailable"), every other harness is an
 *  agent node whose usage is reported or honestly unavailable. */
export const WORK_GRAPH_SHELL_HARNESS = "shell";

export function isShellHarness(harness: string): boolean {
  return harness === WORK_GRAPH_SHELL_HARNESS;
}

/** One intent node: what the human wants. Fields mirror the contract
 *  literally; `model` is nullable because a shell node has none, and an
 *  agent node may legitimately ride its harness default. */
export type WorkGraphIntentNode = {
  id: string;
  title: string;
  /** From the real harness catalog (e.g. `pi`, `claude-code`, `shell`). */
  harness: string;
  /** From the real per-harness model catalog; null = harness default /
   *  not applicable (shell). */
  model: string | null;
  dependsOn: string[];
  /** What this node must do. */
  prompt: string;
  /** false = not to be relaunched (deleting marks; stopping is separate). */
  enabled: boolean;
};

/** Drift as the task defines it: which paths the node EXPECTED versus
 *  which it CREATED, straight from the run record. Both lists optional —
 *  the view renders whatever the record actually carried. */
export type WorkGraphDrift = {
  expected: string[];
  created: string[];
};

/** Observed usage for one agent node. Mirrors the run-record honesty
 *  rules: a recorded 0 is a measured zero only when `usageKnown` is true;
 *  null means the record did not carry the value. Cost is not part of the
 *  runtime's evidence schema, so this view never renders one. */
export type WorkGraphUsage = {
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  usageKnown?: boolean | null;
};

/** The evidence one node produced. Every field optional: the daemon writes
 *  what the run actually recorded. Unknown keys ride through (`passthrough`
 *  below) so the view can spell out — never silently drop — evidence the
 *  schema does not know yet. */
export type WorkGraphEvidence = {
  exitCode?: number | null;
  stdout?: string | null;
  stderr?: string | null;
  stdoutPath?: string | null;
  stderrPath?: string | null;
  drift?: WorkGraphDrift | null;
  usage?: WorkGraphUsage | null;
  [key: string]: unknown;
};

/** One state node: what the daemon OBSERVED. Written only by the daemon. */
export type WorkGraphStateNode = {
  id: string;
  status: WorkGraphStatus;
  /** The Mentu run this node produced, when any. The UI may resolve this
   *  through the existing mentu RPCs — it never fabricates one. */
  runId?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  evidence?: WorkGraphEvidence | null;
  lastError?: string | null;
  [key: string]: unknown;
};

export type WorkGraphDocument = {
  version: 1;
  intent: { nodes: WorkGraphIntentNode[] };
  state: { updatedAt: string; nodes: WorkGraphStateNode[] };
};

// ---------------------------------------------------------------------------
// zod schemas (lenient on unknown evidence/state keys, strict on the seam)
// ---------------------------------------------------------------------------

const isoText = z.string().min(1);
const idText = z.string().min(1).max(200);

export const workGraphDriftSchema = z.object({
  expected: z.array(z.string()).optional().default([]),
  created: z.array(z.string()).optional().default([]),
});

export const workGraphUsageSchema = z
  .object({
    model: z.string().nullable().optional(),
    inputTokens: z.number().nullable().optional(),
    outputTokens: z.number().nullable().optional(),
    usageKnown: z.boolean().nullable().optional(),
  })
  .passthrough();

export const workGraphEvidenceSchema = z
  .object({
    exitCode: z.number().int().nullable().optional(),
    stdout: z.string().nullable().optional(),
    stderr: z.string().nullable().optional(),
    stdoutPath: z.string().nullable().optional(),
    stderrPath: z.string().nullable().optional(),
    drift: workGraphDriftSchema.nullable().optional(),
    usage: workGraphUsageSchema.nullable().optional(),
  })
  .passthrough();

export const workGraphIntentNodeSchema = z.object({
  id: idText,
  title: z.string().min(1).max(500),
  harness: z.string().min(1).max(200),
  model: z.string().min(1).max(500).nullable().optional().default(null),
  dependsOn: z.array(z.string().min(1).max(200)).optional().default([]),
  prompt: z.string().max(100_000).optional().default(""),
  enabled: z.boolean().optional().default(true),
});

export const workGraphStateNodeSchema = z
  .object({
    id: idText,
    status: z.enum(WORK_GRAPH_STATUSES),
    runId: z.string().nullable().optional(),
    startedAt: isoText.nullable().optional(),
    endedAt: isoText.nullable().optional(),
    evidence: workGraphEvidenceSchema.nullable().optional(),
    lastError: z.string().nullable().optional(),
  })
  .passthrough();

const intentSection = z.object({ nodes: z.array(workGraphIntentNodeSchema) });
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
        message: issue ? `${where}: ${issue.message}` : "structurally invalid graph",
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
