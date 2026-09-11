// MIT Copyright (c) 2026 Lovecast Inc.
// The workflow LIBRARY: multiple named, configurable work graphs for one
// workspace, plus which one is selected. This is a NEW, purely ADDITIVE
// sibling of `.drogon/graph.json` — it lives at `.drogon/workflows.json`
// and is read/written through the EXISTING generic files seam
// (`files.v1` / `FileBridge.fileRead`/`fileWrite`), never through
// `graph.write_intent`. The daemon has zero awareness of this file: it
// never reads it, never writes it, and nothing about `.drogon/graph.json`'s
// contract (the `intent`/`state` ownership split, its version, its
// existing readers) changes because this file exists.
//
// Why a sibling file and not a key inside `graph.json`'s `intent`: the
// daemon's `graph.read`/`graph.write_intent` RPCs round-trip `intent`
// through a TYPED Rust struct (`GraphIntent { nodes }`) that only knows
// `nodes` — an extra top-level key would survive on DISK (the store merges
// unknown keys forward) but would never come back in an RPC RESPONSE, so
// the renderer could never observe its own data through the seam it must
// also use for the live graph. A separate file avoids that trap entirely
// and keeps the two concerns (what the daemon executes vs. which named
// preset produced it) independently versioned.
//
// "Selecting" a workflow means: (1) persist `selectedWorkflowId` here so
// the choice survives a restart, and (2) copy that workflow's `nodes` into
// the ONE live `.drogon/graph.json` intent through the existing,
// ownership-enforcing `graph.write_intent` — never a second execution
// path. Editing the live graph while a workflow is selected calls
// `updateWorkflowNodes` to keep the library's copy in sync, so the
// selection never silently drifts from what actually runs.

import { z } from "zod";
import { designableIntentNodeSchema } from "../../../../shared/graph-contract";

export const WORKFLOWS_RELATIVE_PATH = ".drogon/workflows.json";
export const WORKFLOWS_VERSION = 1;

/** Hard bound so the library plus every workflow's nodes stays well under
 *  the files seam's MAX_FILE_BYTES (65,536) cap on both read and write. */
export const MAX_WORKFLOWS = 20;
export const MIN_REVIEW_CYCLES = 1;
export const MAX_REVIEW_CYCLES = 10;
export const DEFAULT_MAX_REVIEW_CYCLES = 3;

export const workflowSettingsSchema = z.object({
  /** The owner's checkbox: send an adversarial review once the workflow's
   *  run finishes. Off by default — a new workflow never bills or launches
   *  anything the human did not ask for. */
  adversarialReviewEnabled: z.boolean().default(false),
  /** The bound on review→fix→review cycles. This is an economic/time
   *  safety valve, not a quality target: the loop stops at the cap even if
   *  still failing, and says so exactly — never a quiet success. */
  maxReviewCycles: z
    .number()
    .int()
    .min(MIN_REVIEW_CYCLES)
    .max(MAX_REVIEW_CYCLES)
    .default(DEFAULT_MAX_REVIEW_CYCLES),
});
export type WorkflowSettings = z.infer<typeof workflowSettingsSchema>;

export function defaultWorkflowSettings(): WorkflowSettings {
  return { adversarialReviewEnabled: false, maxReviewCycles: DEFAULT_MAX_REVIEW_CYCLES };
}

/** One workflow: a named, saved snapshot of intent nodes plus its own
 *  review configuration. `nodes` uses the SAME node schema the live graph
 *  uses (`designableIntentNodeSchema`), so a workflow's nodes are exactly
 *  what `graph.write_intent` will accept when this workflow is selected. */
export const workflowEntrySchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  nodes: z.array(designableIntentNodeSchema).default([]),
  settings: workflowSettingsSchema.default(() => defaultWorkflowSettings()),
  /** The adversarial-review loop's last known outcome for this workflow,
   *  persisted so "which cycle it is on" and the final verdict survive a
   *  reload — reconciled against REAL daemon-observed node state before
   *  ever being trusted (see adversarial-loop.ts), never displayed as-is. */
  lastLoop: z.unknown().optional(),
});
export type WorkflowEntry = z.infer<typeof workflowEntrySchema>;

// Top-level keys are deliberately REQUIRED (no defaults): a file that lacks
// this exact shape — say, `.drogon/graph.json`'s bytes reaching this parser
// by accident — must be refused as unreadable, never silently accepted as
// an "empty library" that a later save could then overwrite.
export const workflowLibrarySchema = z.object({
  version: z.literal(WORKFLOWS_VERSION),
  selectedWorkflowId: z.string().nullable(),
  workflows: z.array(workflowEntrySchema),
});
export type WorkflowLibrary = z.infer<typeof workflowLibrarySchema>;

export function emptyLibrary(): WorkflowLibrary {
  return { version: WORKFLOWS_VERSION, selectedWorkflowId: null, workflows: [] };
}

export type WorkflowLibraryParseResult =
  | { ok: true; library: WorkflowLibrary }
  | { ok: false; message: string };

/** Parses the exact bytes of `.drogon/workflows.json`. Never throws: a
 *  missing or unreadable library reads as honestly absent (the caller
 *  falls back to an in-memory default), never a crash and never a silent
 *  write to "fix" it. */
export function parseWorkflowLibrary(raw: string): WorkflowLibraryParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  const parsed = workflowLibrarySchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      message: issue ? `${issue.path.join(".") || "document"}: ${issue.message}` : "invalid workflow library",
    };
  }
  return { ok: true, library: parsed.data };
}

export function serializeWorkflowLibrary(library: WorkflowLibrary): string {
  return JSON.stringify(library, null, 2);
}

function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${random}`;
}

export type LibraryMutationResult =
  | { ok: true; library: WorkflowLibrary; workflow: WorkflowEntry }
  | { ok: false; message: string };

/** Creates a workflow, seeded with `nodes` (typically the live graph's
 *  current intent, or empty for a blank one), and selects it. Refuses past
 *  `MAX_WORKFLOWS` rather than silently dropping the oldest — the human
 *  decides what to delete. */
export function createWorkflow(
  library: WorkflowLibrary,
  name: string,
  nodes: unknown[],
  now: string,
): LibraryMutationResult {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, message: "A workflow needs a name." };
  if (library.workflows.length >= MAX_WORKFLOWS) {
    return {
      ok: false,
      message: `This workspace already has ${MAX_WORKFLOWS} workflows, the most this build keeps. Delete one first.`,
    };
  }
  const workflow: WorkflowEntry = {
    id: newId("wf"),
    name: trimmed,
    createdAt: now,
    updatedAt: now,
    nodes: nodes as WorkflowEntry["nodes"],
    settings: defaultWorkflowSettings(),
  };
  return {
    ok: true,
    library: {
      ...library,
      selectedWorkflowId: workflow.id,
      workflows: [...library.workflows, workflow],
    },
    workflow,
  };
}

export function findWorkflow(library: WorkflowLibrary, id: string | null): WorkflowEntry | null {
  if (!id) return null;
  return library.workflows.find((workflow) => workflow.id === id) ?? null;
}

export function selectWorkflow(library: WorkflowLibrary, id: string): WorkflowLibrary {
  if (!library.workflows.some((workflow) => workflow.id === id)) return library;
  return { ...library, selectedWorkflowId: id };
}

export function renameWorkflow(
  library: WorkflowLibrary,
  id: string,
  name: string,
  now: string,
): WorkflowLibrary {
  const trimmed = name.trim();
  if (trimmed.length === 0) return library;
  return {
    ...library,
    workflows: library.workflows.map((workflow) =>
      workflow.id === id ? { ...workflow, name: trimmed, updatedAt: now } : workflow,
    ),
  };
}

/** Deletes a workflow. When it was selected, selects the first remaining
 *  workflow (or null — an honest "nothing selected", never a fabricated
 *  choice). */
export function deleteWorkflow(library: WorkflowLibrary, id: string): WorkflowLibrary {
  const workflows = library.workflows.filter((workflow) => workflow.id !== id);
  const selectedWorkflowId =
    library.selectedWorkflowId === id ? (workflows[0]?.id ?? null) : library.selectedWorkflowId;
  return { ...library, workflows, selectedWorkflowId };
}

export function updateWorkflowSettings(
  library: WorkflowLibrary,
  id: string,
  patch: Partial<WorkflowSettings>,
  now: string,
): WorkflowLibrary {
  return {
    ...library,
    workflows: library.workflows.map((workflow) =>
      workflow.id === id
        ? { ...workflow, settings: { ...workflow.settings, ...patch }, updatedAt: now }
        : workflow,
    ),
  };
}

/** Keeps the workflow's saved node snapshot in sync with what was just
 *  written to the live graph, so "the selected workflow" never silently
 *  diverges from what actually runs. */
export function updateWorkflowNodes(
  library: WorkflowLibrary,
  id: string,
  nodes: unknown[],
  now: string,
): WorkflowLibrary {
  return {
    ...library,
    workflows: library.workflows.map((workflow) =>
      workflow.id === id
        ? { ...workflow, nodes: nodes as WorkflowEntry["nodes"], updatedAt: now }
        : workflow,
    ),
  };
}

/** Persists the adversarial-review loop's ledger onto its workflow. Stored
 *  as `unknown` here deliberately (adversarial-loop.ts owns the shape);
 *  this module only knows it rides along with the workflow it belongs to. */
export function updateWorkflowLoop(
  library: WorkflowLibrary,
  id: string,
  lastLoop: unknown,
  now: string,
): WorkflowLibrary {
  return {
    ...library,
    workflows: library.workflows.map((workflow) =>
      workflow.id === id ? { ...workflow, lastLoop, updatedAt: now } : workflow,
    ),
  };
}
