// MIT Copyright (c) 2026 Lovecast Inc.
// The bounded adversarial-review loop: TWO GENUINELY DISTINCT roles —
// Adversarial test (find edge cases and failure) and Code review (review
// the changes and verify fixes) — alternating up to `maxCycles` pairs over
// a workflow that just finished. This module is a PURE reducer plus
// deterministic id/prompt builders — no React, no IPC. The I/O hook
// (`use-adversarial-loop.ts`) is the only thing that calls the daemon; it
// feeds this reducer real, daemon-observed node statuses and carries out
// exactly the action the reducer returns.
//
// The two roles are NOT a relabeling of one alternating role: `phase`
// stays named `reviewing`/`fixing` internally (renaming it is a larger,
// riskier diff for no behavioral gain — see the phase constants below for
// the mapping), but `buildReviewPrompt` and `buildFixPrompt` below send
// GENUINELY DIFFERENT instructions. `reviewing` launches the Adversarial
// test brief (adversarially try to break the work); `fixing` launches the
// Code review brief (review the changes with a reviewer's eyes — not
// limited to what the adversarial pass flagged — fix every real problem,
// and VERIFY each fix by actually re-running the relevant check rather
// than assuming it worked). A canvas that shows two role nodes while one
// brief runs under both labels is exactly the dishonesty this product
// refuses; this file is the one place that must never let that happen.
//
// The loop reuses the SAME execution path as everything else in the work
// graph: every review/fix "cycle" is an ordinary intent node, appended
// through `graph.write_intent` and launched through `graph.compile` /
// `graph.run` — the identical seam `WorkGraphDesigner` uses for the human's
// own nodes. There is no second engine and no conditional-branching
// primitive invented in the compiler: sequencing (review, THEN maybe fix,
// THEN the next review) is this reducer deciding, cycle by cycle, which
// SINGLE node to launch next, only once the previous one has genuinely
// reached a terminal, daemon-observed status.
//
// Honesty rules this reducer enforces (non-negotiable, per the task):
//   - "the review passed" is never inferred. It is exactly: the review
//     node's OWN status, as the daemon's state projector reports it, is
//     `succeeded` — which itself is only true because the node's
//     `verifyCommand` (a deterministic `test -f <marker>`) really passed.
//     A review node that finishes without a clear verdict fails the verify
//     command and is honestly `failed`, not silently treated as clean.
//   - reaching the cap while still failing renders EXACTLY
//     "Stopped after N review cycles, still failing." — never a quiet
//     success, never a vaguer message.
//   - `unverifiable` (loss of contact) and `blocked` are their own terminal
//     outcomes, distinct from both "passed" and "failed": the loop never
//     guesses what an unconfirmed node did, and never spends another cycle
//     "fixing" something that was never actually observed to fail.
//   - the base workflow itself must have fully succeeded before a review is
//     even attempted; a workflow that already failed is reported as such,
//     never quietly "reviewed" anyway.
//
// Model policy: `ADVERSARIAL_HARNESS`/`ADVERSARIAL_MODEL` below are the
// SAFE DEFAULT stored on each node's intent (satisfies shape validation,
// and is exactly what runs if the daemon predates failover) — but the I/O
// hook launches every node through `graph.run_node_failover`
// (`crates/drogon-core/src/graph_rpc.rs`), which OVERRIDES them per attempt
// with whichever runtime the workspace's Subagent policy says to try: the
// free local `pi` model when nothing is configured yet, so this loop costs
// nothing before anyone opens the policy panel, and a real approved
// runtime once one is. The max-cycle cap is a TIME safety valve, not a
// spend one — the free default is what keeps spend at zero by default, not
// the cap.

import { z } from "zod";
import type { WorkGraphStatus } from "../../../../shared/work-graph-contract";

/** The only harness/model the adversarial loop is ever allowed to launch,
 *  per AGENTS.md: free, local, never billed. */
export const ADVERSARIAL_HARNESS = "pi";
export const ADVERSARIAL_MODEL = "qwen3.8-flash-next-nvidia-nvfp4";

/** Deterministic, id-safe (`[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}`), short token
 *  for one triggering run — FNV-1a-32 rendered as 8 lowercase hex chars.
 *  No crypto dependency; this only needs to be stable and collision-safe
 *  enough for a display/node-id token, not cryptographic. */
export function runToken(baseRunId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < baseRunId.length; index += 1) {
    hash ^= baseRunId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function reviewNodeId(token: string, cycle: number): string {
  return `adv-${token}-review-${cycle}`;
}
export function fixNodeId(token: string, cycle: number): string {
  return `adv-${token}-fix-${cycle}`;
}
export function markerDir(token: string): string {
  return `.drogon/adversarial/${token}`;
}
export function passMarkerPath(token: string, cycle: number): string {
  return `${markerDir(token)}/cycle-${cycle}.pass`;
}
export function failMarkerPath(token: string, cycle: number): string {
  return `${markerDir(token)}/cycle-${cycle}.fail`;
}
/** The review node's ENTIRE pass/fail verdict, in one deterministic shell
 *  check — never inferred by this app from the agent's prose. */
export function reviewVerifyCommand(token: string, cycle: number): string {
  return `test -f ${passMarkerPath(token, cycle)}`;
}

/** The Adversarial-test role's brief: actively try to BREAK the work,
 *  never confirm it. Distinct from `buildFixPrompt`'s Code-review role —
 *  this one never fixes anything, only finds and records. */
export function buildReviewPrompt(input: {
  token: string;
  cycle: number;
  maxCycles: number;
}): string {
  const { token, cycle, maxCycles } = input;
  const dir = markerDir(token);
  return [
    "You are an ADVERSARIAL reviewer. Your job is to find real problems in the work the workflow just produced — actively try to BREAK it, not to confirm it. Read the actual changes (diffs, files, test/build output) in this workspace. Do not rubber-stamp: a review that finds nothing without a genuine attempt to break the work is worthless.",
    "",
    `This is review cycle ${cycle} of at most ${maxCycles}.`,
    "",
    `If, after a serious attempt to break it, you find NO real problem, run exactly:\n  mkdir -p ${dir} && touch ${passMarkerPath(token, cycle)}`,
    `If you find one or more real problems, run exactly:\n  mkdir -p ${dir}\nthen WRITE a full, specific description of every problem you found into:\n  ${failMarkerPath(token, cycle)}\n(create that file with your findings in it).`,
    "",
    "Create exactly one of those two files before you finish. Nothing else decides whether this review passed or failed.",
  ].join("\n");
}

/** The Code review role's brief — deliberately NOT "read the findings and
 *  patch them": a code reviewer reads the actual changes with their own
 *  judgment (the adversarial findings are a starting point, never the
 *  whole scope) and, unlike the adversarial-test role, is responsible for
 *  VERIFYING each fix actually works rather than declaring it found or
 *  broke something. */
export function buildFixPrompt(input: { token: string; cycle: number }): string {
  const { token, cycle } = input;
  return [
    `You are a CODE REVIEWER, not the adversarial tester that just ran. An adversarial pass (cycle ${cycle}) found real problems, recorded at:\n  ${failMarkerPath(token, cycle)}`,
    "",
    "Read that file first, then review the actual changes in this workspace (the diff, the affected files) with your own reviewer's judgment — you are not limited to what the adversarial pass wrote down. Flag and fix anything else genuinely wrong you notice too.",
    "",
    "Fix every real problem you confirm, adversarially-found or your own — make the work genuinely correct, not cosmetically patched. Then VERIFY each fix yourself: re-run whatever check, test, or build step is relevant to it, and confirm the problem is actually gone. Do not report a fix as done because you believe it should work; confirm it ran clean.",
    "",
    `This review-and-verify pass is cycle ${cycle} of the same bounded loop; the next adversarial test checks your work again.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

export type LoopPhase =
  | "awaiting_base"
  | "base_failed"
  | "reviewing"
  | "fixing"
  | "passed"
  | "stopped_failing"
  | "fix_failed"
  | "unverifiable"
  | "blocked"
  /** Set only by the I/O hook (never by this reducer): the daemon's own
   *  `graph.compile`/`graph.run` refused to launch the review/fix node at
   *  all (e.g. a compiler finding, or the RPC itself erroring) — distinct
   *  from every OBSERVED node outcome above, because nothing ever ran. */
  | "launch_refused";

export const TERMINAL_PHASES: ReadonlySet<LoopPhase> = new Set([
  "base_failed",
  "passed",
  "stopped_failing",
  "fix_failed",
  "unverifiable",
  "blocked",
  "launch_refused",
]);

export function isTerminalPhase(phase: LoopPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

export type LoopLedger = {
  workflowId: string;
  /** Short token derived from the triggering run; every review/fix node id
   *  and marker path for this loop is derived from it. */
  token: string;
  baseRunId: string;
  baseNodeIds: string[];
  maxCycles: number;
  /** 0 until the first review node is launched. */
  cycle: number;
  phase: LoopPhase;
  reviewNodeIds: string[];
  fixNodeIds: string[];
  /** The node currently being awaited, or null when nothing is in flight
   *  (terminal, or still waiting on the base workflow itself). */
  activeNodeId: string | null;
  startedAt: string;
  updatedAt: string;
  /** The exact, current human-facing status line. Always in sync with
   *  `phase`/`cycle` — never computed separately by the UI so it can never
   *  drift from what this reducer actually decided. */
  message: string;
};

export type LoopAction =
  | { kind: "none" }
  | {
      kind: "launch_review";
      nodeId: string;
      cycle: number;
      prompt: string;
      verifyCommand: string;
    }
  | { kind: "launch_fix"; nodeId: string; cycle: number; prompt: string };

export function startLedger(input: {
  workflowId: string;
  baseRunId: string;
  baseNodeIds: string[];
  maxCycles: number;
  now: string;
}): LoopLedger {
  return {
    workflowId: input.workflowId,
    token: runToken(input.baseRunId),
    baseRunId: input.baseRunId,
    baseNodeIds: [...input.baseNodeIds],
    maxCycles: input.maxCycles,
    cycle: 0,
    phase: "awaiting_base",
    reviewNodeIds: [],
    fixNodeIds: [],
    activeNodeId: null,
    startedAt: input.now,
    updatedAt: input.now,
    message: "Waiting for the workflow's run to finish before reviewing…",
  };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Advances the ledger by exactly one decision, given the LATEST
 *  daemon-observed status for every node this ledger cares about (missing
 *  = not read yet, treated as still in flight — never as any particular
 *  outcome). Pure: no clock reads besides the caller-supplied `now`. */
export function advanceLoop(
  ledger: LoopLedger,
  observed: ReadonlyMap<string, WorkGraphStatus>,
  now: string,
): { ledger: LoopLedger; action: LoopAction } {
  if (isTerminalPhase(ledger.phase)) return { ledger, action: { kind: "none" } };

  if (ledger.phase === "awaiting_base") {
    const statuses = ledger.baseNodeIds.map((id) => observed.get(id));
    if (statuses.some((status) => status === undefined)) return { ledger, action: { kind: "none" } };
    const inFlight = ledger.baseNodeIds.find(
      (id, index) => statuses[index] === "idle" || statuses[index] === "running",
    );
    if (inFlight) return { ledger, action: { kind: "none" } };
    const bad = ledger.baseNodeIds.find((id, index) => statuses[index] !== "succeeded");
    if (bad) {
      const badStatus = observed.get(bad);
      return {
        ledger: {
          ...ledger,
          phase: "base_failed",
          activeNodeId: null,
          updatedAt: now,
          message: `Adversarial review not started: node '${bad}' is ${badStatus}, not succeeded.`,
        },
        action: { kind: "none" },
      };
    }
    const cycle = 1;
    const nodeId = reviewNodeId(ledger.token, cycle);
    return {
      ledger: {
        ...ledger,
        phase: "reviewing",
        cycle,
        activeNodeId: nodeId,
        reviewNodeIds: [nodeId],
        updatedAt: now,
        message: `Reviewing… cycle ${cycle} of ${ledger.maxCycles}.`,
      },
      action: {
        kind: "launch_review",
        nodeId,
        cycle,
        prompt: buildReviewPrompt({ token: ledger.token, cycle, maxCycles: ledger.maxCycles }),
        verifyCommand: reviewVerifyCommand(ledger.token, cycle),
      },
    };
  }

  const activeNodeId = ledger.activeNodeId;
  if (!activeNodeId) return { ledger, action: { kind: "none" } };
  const status = observed.get(activeNodeId);
  if (status === undefined || status === "idle" || status === "running") {
    return { ledger, action: { kind: "none" } };
  }

  if (ledger.phase === "reviewing") {
    if (status === "succeeded") {
      return {
        ledger: {
          ...ledger,
          phase: "passed",
          activeNodeId: null,
          updatedAt: now,
          message: `Adversarial review passed on cycle ${ledger.cycle}.`,
        },
        action: { kind: "none" },
      };
    }
    if (status === "unverifiable") {
      return {
        ledger: {
          ...ledger,
          phase: "unverifiable",
          activeNodeId: null,
          updatedAt: now,
          message: `Adversarial review outcome unverifiable on cycle ${ledger.cycle} — contact with the reviewer was lost. Nothing about pass or fail is claimed.`,
        },
        action: { kind: "none" },
      };
    }
    if (status === "blocked") {
      return {
        ledger: {
          ...ledger,
          phase: "blocked",
          activeNodeId: null,
          updatedAt: now,
          message: `Adversarial review cycle ${ledger.cycle} was blocked before it ran.`,
        },
        action: { kind: "none" },
      };
    }
    // status === "failed": the review found real problems.
    if (ledger.cycle >= ledger.maxCycles) {
      return {
        ledger: {
          ...ledger,
          phase: "stopped_failing",
          activeNodeId: null,
          updatedAt: now,
          message: `Stopped after ${plural(ledger.cycle, "review cycle")}, still failing.`,
        },
        action: { kind: "none" },
      };
    }
    const nodeId = fixNodeId(ledger.token, ledger.cycle);
    return {
      ledger: {
        ...ledger,
        phase: "fixing",
        activeNodeId: nodeId,
        fixNodeIds: [...ledger.fixNodeIds, nodeId],
        updatedAt: now,
        message: `Review cycle ${ledger.cycle} found problems — fixing before the next review.`,
      },
      action: {
        kind: "launch_fix",
        nodeId,
        cycle: ledger.cycle,
        prompt: buildFixPrompt({ token: ledger.token, cycle: ledger.cycle }),
      },
    };
  }

  // ledger.phase === "fixing"
  if (status === "succeeded") {
    const cycle = ledger.cycle + 1;
    const nodeId = reviewNodeId(ledger.token, cycle);
    return {
      ledger: {
        ...ledger,
        phase: "reviewing",
        cycle,
        activeNodeId: nodeId,
        reviewNodeIds: [...ledger.reviewNodeIds, nodeId],
        updatedAt: now,
        message: `Reviewing… cycle ${cycle} of ${ledger.maxCycles}.`,
      },
      action: {
        kind: "launch_review",
        nodeId,
        cycle,
        prompt: buildReviewPrompt({ token: ledger.token, cycle, maxCycles: ledger.maxCycles }),
        verifyCommand: reviewVerifyCommand(ledger.token, cycle),
      },
    };
  }
  if (status === "unverifiable") {
    return {
      ledger: {
        ...ledger,
        phase: "unverifiable",
        activeNodeId: null,
        updatedAt: now,
        message: `The fix for cycle ${ledger.cycle} is unverifiable — contact with it was lost. Nothing about pass or fail is claimed.`,
      },
      action: { kind: "none" },
    };
  }
  if (status === "blocked") {
    return {
      ledger: {
        ...ledger,
        phase: "blocked",
        activeNodeId: null,
        updatedAt: now,
        message: `The fix for cycle ${ledger.cycle} was blocked before it ran.`,
      },
      action: { kind: "none" },
    };
  }
  // status === "failed": the fix attempt itself failed to run.
  return {
    ledger: {
      ...ledger,
      phase: "fix_failed",
      activeNodeId: null,
      updatedAt: now,
      message: `Stopped: the fix attempt for cycle ${ledger.cycle} failed before a re-review could run.`,
    },
    action: { kind: "none" },
  };
}

// ---------------------------------------------------------------------------
// Persisted-ledger parsing (the workflow library stores this as `unknown`;
// a future/older build's shape, or plain corruption, must never crash a
// mount — it just means the loop's own history could not be resumed).
// ---------------------------------------------------------------------------

const loopPhaseSchema = z.enum([
  "awaiting_base",
  "base_failed",
  "reviewing",
  "fixing",
  "passed",
  "stopped_failing",
  "fix_failed",
  "unverifiable",
  "blocked",
  "launch_refused",
]);

export const loopLedgerSchema = z.object({
  workflowId: z.string().min(1),
  token: z.string().min(1),
  baseRunId: z.string().min(1),
  baseNodeIds: z.array(z.string()),
  maxCycles: z.number().int().min(1),
  cycle: z.number().int().min(0),
  phase: loopPhaseSchema,
  reviewNodeIds: z.array(z.string()),
  fixNodeIds: z.array(z.string()),
  activeNodeId: z.string().nullable(),
  startedAt: z.string(),
  updatedAt: z.string(),
  message: z.string(),
});

/** Parses a persisted ledger for exactly one workflow. Never throws: an
 *  unreadable or mismatched (e.g. belongs to a different workflow) value
 *  is `null`, meaning "no resumable loop history" — never a guess. */
export function parseLoopLedger(raw: unknown, workflowId: string): LoopLedger | null {
  const parsed = loopLedgerSchema.safeParse(raw);
  if (!parsed.success || parsed.data.workflowId !== workflowId) return null;
  return parsed.data;
}
