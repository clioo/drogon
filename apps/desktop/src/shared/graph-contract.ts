// Work-graph authoring contract (the write half of work-graph-contract.ts).
// The read-only view renders `.drogon/graph.json` through the files bridge;
// DESIGNING the graph needs the daemon's ownership-enforcing seam instead:
//
//   - `graph.write_intent` — replaces ONLY the file's `intent` half,
//     atomically (temp file + fsync + rename), merging unknown fields
//     forward, refusing any payload that carries `state`. `state` is the
//     daemon's alone; the UI never writes it.
//   - `graph.compile` — compiles (part of) the intent to a Mentu recipe and
//     returns the runtime's own findings WITHOUT running anything.
//   - `graph.run` — compiles, mints the daemon's `mentu.approve`, and
//     launches through the ONE existing runtime path. No second engine.
//
// Shapes mirror the serde camelCase projections of
// `crates/drogon-protocol/src/graph.rs` exactly. The renderer validates its
// own payloads BEFORE the IPC hop so a bad graph is refused at the author,
// never discovered after the daemon wrote it.

import { z } from "zod";
import type { Result } from "./session-contract";
import { workGraphIntentNodeSchema, workGraphStateNodeSchema } from "./work-graph-contract";

export const GRAPH_CAPABILITY = "graph.v1";

/** Re-exported for callers that want one import site for graph seams. */
export const GRAPH_RELATIVE_PATH = ".drogon/graph.json";

/** The per-node layout coordinates the DESIGNER owns. This is deliberately
 *  NOT part of the daemon's `GraphNodeIntent`: the store preserves unknown
 *  node fields verbatim (see `store.rs`'s merge), so the canvas parks its
 *  positions inside `intent.nodes[]` and the daemon carries them without
 *  understanding them. `x`/`y` are canvas coordinates, never execution
 *  semantics. */
export const workGraphNodePositionSchema = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .strict();

/** An intent node as the designer serializes it: the contract node (which
 *  tolerates unknown fields via passthrough) plus the optional position. */
export const designableIntentNodeSchema = workGraphIntentNodeSchema.passthrough();

export type DesignableIntentNode = z.infer<typeof designableIntentNodeSchema>;

/** The exact payload `graphWriteIntent` accepts: an OBJECT with a `nodes`
 *  array and — enforced here and again daemon-side — NO `state` key. */
export const graphWriteIntentPayloadSchema = z
  .object({ nodes: z.array(designableIntentNodeSchema) })
  // STRICT: an unknown key here must REFUSE, not ride through — a `state`
  // key that zod silently stripped would bypass the ownership check below.
  .strict()
  .superRefine((value, ctx) => {
    if ("state" in value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state"],
        message:
          "`state` is owned by the daemon and cannot be written through graph.write_intent; " +
          "only the daemon observes and records it.",
      });
    }
  });

export type GraphWriteIntentPayload = z.infer<typeof graphWriteIntentPayloadSchema>;

// ---------------------------------------------------------------------------
// Params (validated client-side; the daemon re-validates)
// ---------------------------------------------------------------------------

const workspaceId = z.string().min(1).max(128);

export const graphReadParamsSchema = z.object({ workspaceId });

export type GraphReadParams = z.infer<typeof graphReadParamsSchema>;

export const graphWriteIntentParamsSchema = z
  .object({
    workspaceId,
    intent: graphWriteIntentPayloadSchema,
  })
  // STRICT: same ownership rule at the params level — a sibling `state`
  // key must be refused before any IPC, never stripped and ignored.
  .strict()
  .superRefine((value, ctx) => {
    if ("state" in (value as Record<string, unknown>)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state"],
        message: "graph.write_intent refuses a payload that carries `state`.",
      });
    }
  });

export type GraphWriteIntentParams = {
  workspaceId: string;
  /** The intent object; NEVER carries a `state` key (schema-enforced). */
  intent: { nodes: unknown[] };
};

export const graphCompileParamsSchema = z
  .object({
    workspaceId,
    /** The node plus its transitive dependencies. */
    nodeId: z.string().min(1).max(200).optional(),
    /** An explicit selection, still closed over its dependencies. */
    nodeIds: z.array(z.string().min(1).max(200)).optional(),
  })
  .refine(
    (value) =>
      Boolean(value.nodeId) !== Boolean(value.nodeIds && value.nodeIds.length > 0),
    { message: "graph.compile takes either nodeId or a non-empty nodeIds, not both." },
  );

export type GraphCompileParams = {
  workspaceId: string;
  /** The node plus its transitive dependencies. */
  nodeId?: string;
  /** An explicit selection, still closed over its dependencies. */
  nodeIds?: string[];
};

export type GraphRunParams = GraphCompileParams;

// ---------------------------------------------------------------------------
// Results (mirror the daemon's GraphResult / GraphCompileResult / GraphRunResult)
// ---------------------------------------------------------------------------

export const graphStateNodeSchema = workGraphStateNodeSchema;

export const graphResultSchema = z.object({
  graph: z.object({
    version: z.literal(1),
    intent: z.object({ nodes: z.array(workGraphIntentNodeSchema.passthrough()) }),
    state: z.object({
      updatedAt: z.string(),
      nodes: z.array(workGraphStateNodeSchema),
    }),
  }),
});

export const graphFindingSchema = z.object({
  code: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  nodeId: z.string().nullable().optional(),
  message: z.string(),
  recommendation: z.string().nullable().optional(),
});

export const graphCompileResultSchema = z.object({
  recipeId: z.string(),
  recipe: z.unknown(),
  contentHash: z.string(),
  nodeIds: z.array(z.string()),
  findings: z.array(graphFindingSchema),
});

export const graphRunResultSchema = z.object({
  run: z.object({
    id: z.string(),
    status: z.string(),
  }),
  compile: graphCompileResultSchema,
});

/** The compiled-selection preview the canvas shows before running: the
 *  execution order and the runtime's own findings, verbatim. */
export type GraphCompileResult = z.infer<typeof graphCompileResultSchema>;

export type GraphRunResult = z.infer<typeof graphRunResultSchema>;

export type GraphResult = z.infer<typeof graphResultSchema>;

export type GraphFinding = z.infer<typeof graphFindingSchema>;

// ---------------------------------------------------------------------------
// The bridge (preload namespace `window.drogon.graph.*`)
// ---------------------------------------------------------------------------

export interface GraphBridge {
  /** The daemon's own read: projects the state half from real observation
   *  (writing it back when it changed) and returns the whole graph. The
   *  pane's live view runs on this; the raw files bridge is only the
   *  fallback for builds whose daemon predates graph.v1. */
  graphRead(input: GraphReadParams): Promise<Result<GraphResult>>;
  graphWriteIntent(
    input: GraphWriteIntentParams,
  ): Promise<Result<GraphResult>>;
  graphCompile(input: GraphCompileParams): Promise<Result<GraphCompileResult>>;
  graphRun(input: GraphRunParams): Promise<Result<GraphRunResult>>;
}
