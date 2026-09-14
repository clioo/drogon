// The reproducible demo's plan: the phases it walks, the runtimes it offers,
// and how measured tokens become a cost. Pure — no React, no bridge, no DOM —
// so every rule here is testable on its own.
//
// The honesty rules are the product's, not the demo's: a missing token count
// is never a zero, a model with no rate is never priced by guessing, and a
// phase is only "done" when the daemon says the thing it waited for happened.

export type ReproPhaseId =
  | "workspace"
  | "seed"
  | "bot"
  | "policy"
  | "watch"
  | "spec"
  | "firing"
  | "rounds"
  | "evidence";

export type ReproPhase = {
  id: ReproPhaseId;
  title: string;
  /** What this phase proves, shown under its title while it runs. */
  detail: string;
};

/** The demo in order. Each phase is one thing a viewer can watch happen. */
export const REPRO_PHASES: readonly ReproPhase[] = [
  {
    id: "workspace",
    title: "A project of its own",
    detail: "dog-tinder-<tag>, listed under Projects. Every run gets a new one; nothing touches your repos.",
  },
  {
    id: "seed",
    title: "Seed repository",
    detail: "The dog profiles and the test contract the work has to pass.",
  },
  {
    id: "bot",
    title: "The bot that delegates",
    detail: "White walker <tag>, under Chats, on the harness and model you picked above.",
  },
  {
    id: "policy",
    title: "Work Graph policy",
    detail: "Approved runtimes, and the bounded adversarial loop turned on.",
  },
  {
    id: "watch",
    title: "Watch on the spec",
    detail: "A file-digest monitor, approved by its exact rule hash.",
  },
  {
    id: "spec",
    title: "The spec changes",
    detail: "The demo writes specs/dog-tinder.md — that is what the bot sees.",
  },
  {
    id: "firing",
    title: "The bot wakes itself",
    detail: "The watch observes the change and releases real work.",
  },
  {
    id: "rounds",
    title: "Adversarial rounds",
    detail: "The released session fans out to parallel workers, then the daemon breaks, fixes and verifies — up to the round cap.",
  },
  {
    id: "evidence",
    title: "Agent telemetry and cost",
    detail: "Every attempt, verdict and dispatch the daemon recorded, and what the run actually cost.",
  },
];

export type ReproPhaseStatus = "idle" | "running" | "done" | "failed";

export type ReproPhaseState = {
  status: ReproPhaseStatus;
  note: string | null;
};

export function initialPhaseStates(): Record<ReproPhaseId, ReproPhaseState> {
  return Object.fromEntries(
    REPRO_PHASES.map((phase) => [phase.id, { status: "idle", note: null }]),
  ) as Record<ReproPhaseId, ReproPhaseState>;
}

/** The runtime a run works with: a harness this product can run a Work Graph
 *  node on, and the exact model id it receives. Both come from where the
 *  Subagent policy takes them — the host's harness catalog and the harness's
 *  own model list — never from a list this demo ships. */
export type ReproRuntime = { harness: string; model: string };

/** The harnesses a Work Graph node can run on; the picker shows only those
 *  installed here. */
export const REPRO_SUPPORTED_HARNESSES = ["claude", "codex", "opencode", "pi"] as const;

/** Shell-adapter harnesses take no "harness default": the daemon refuses a
 *  node on them without an exact model id, so the demo refuses to start one. */
export function harnessNeedsModel(harness: string): boolean {
  return harness === "pi" || harness === "opencode";
}

/** The model the demo proposes from a harness's own list: the entry the
 *  host recommends, else the first one the host enumerated. Only
 *  host-verified ids qualify — a curated or typed id that this machine never
 *  listed is the viewer's to choose, never the demo's to assume — and the
 *  "harness default" row (an empty id) is not a proposal. Null when the host
 *  enumerated nothing. */
export function pickDemoModel(
  options: readonly { id: string; verified: boolean; recommended: boolean }[],
): string | null {
  const listed = options.filter(
    (option) => option.verified && option.id.trim().length > 0,
  );
  return (listed.find((option) => option.recommended) ?? listed[0])?.id ?? null;
}

export const REPRO_ITERATION_CHOICES = [1, 2, 3] as const;
export const DEFAULT_REPRO_ITERATIONS = 2;

// ---------------------------------------------------------------- cost

export type ReproRate = {
  kind: "demo_rate" | "local_free" | "list_price";
  label: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/** Rates in USD per million tokens. Drogon ships no provider list prices: a
 *  paid model has no entry until someone adds one, and an unpriced
 *  measurement is reported as unpriced — never as zero. Mirrors
 *  `scripts/reproduce-model-rates.v1.json`. */
export const REPRO_RATES: Readonly<Record<string, ReproRate>> = {
  "fixture/dog-tinder": {
    kind: "demo_rate",
    label: "demo rate",
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "dog-tinder": {
    kind: "demo_rate",
    label: "demo rate",
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
};

export type ReproUsageEntry = {
  role?: string | null;
  harness?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
};

export type ReproCostBucket =
  | "exact"
  | "partial"
  | "local_free"
  | "unpriced"
  | "not_reported";

export type ReproCost = {
  bucket: ReproCostBucket;
  /** Null whenever nothing could be priced: an absent cost, never a zero. */
  totalUsd: number | null;
  measurements: number;
  pricedMeasurements: number;
  unpricedModels: string[];
  inputTokens: number | null;
  outputTokens: number | null;
  byRole: Record<string, number>;
  rateKinds: string[];
};

function rateFor(
  entry: ReproUsageEntry,
  rates: Readonly<Record<string, ReproRate>>,
): ReproRate | null {
  const model = (entry.model ?? "").trim();
  const harness = (entry.harness ?? "").trim();
  for (const key of [`${harness}/${model}`, model]) {
    if (key && rates[key]) return rates[key];
  }
  return null;
}

const million = 1_000_000;

/** Prices a usage ledger. Every bucket is a different truth, and the caller
 *  must show which one it got: `exact` (all measurements priced),
 *  `partial` (some model had no rate), `local_free` (priced, and every rate
 *  is a declared-free local model), `unpriced` (tokens measured, no rate at
 *  all) and `not_reported` (no agent reported tokens — absence, not zero). */
export function priceReproUsage(
  entries: readonly ReproUsageEntry[],
  rates: Readonly<Record<string, ReproRate>> = REPRO_RATES,
): ReproCost {
  const byRole: Record<string, number> = {};
  const kinds = new Set<string>();
  const unpricedModels: string[] = [];
  let priced = 0;
  let total = 0;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  for (const entry of entries) {
    if (typeof entry.inputTokens === "number")
      inputTokens = (inputTokens ?? 0) + entry.inputTokens;
    if (typeof entry.outputTokens === "number")
      outputTokens = (outputTokens ?? 0) + entry.outputTokens;
    const rate = rateFor(entry, rates);
    if (!rate) {
      const name = `${entry.harness ?? "—"}/${entry.model ?? "—"}`;
      if (!unpricedModels.includes(name)) unpricedModels.push(name);
      continue;
    }
    priced += 1;
    kinds.add(rate.kind);
    const value =
      ((entry.inputTokens ?? 0) / million) * rate.input +
      ((entry.outputTokens ?? 0) / million) * rate.output +
      ((entry.cacheReadTokens ?? 0) / million) * rate.cacheRead +
      ((entry.cacheWriteTokens ?? 0) / million) * rate.cacheWrite;
    total += value;
    const role = entry.role ?? "sin rol";
    byRole[role] = Number(((byRole[role] ?? 0) + value).toFixed(6));
  }

  let bucket: ReproCostBucket;
  if (entries.length === 0) bucket = "not_reported";
  else if (priced === 0) bucket = "unpriced";
  else if (unpricedModels.length > 0) bucket = "partial";
  else if ([...kinds].every((kind) => kind === "local_free"))
    bucket = "local_free";
  else bucket = "exact";

  return {
    bucket,
    totalUsd: priced === 0 ? null : Number(total.toFixed(6)),
    measurements: entries.length,
    pricedMeasurements: priced,
    unpricedModels,
    inputTokens,
    outputTokens,
    byRole,
    rateKinds: [...kinds],
  };
}

/** The sentence a cost tile shows. Never "$0.00" for something unmeasured. */
export function describeReproCost(cost: ReproCost): string {
  switch (cost.bucket) {
    case "exact":
      return `${cost.pricedMeasurements} measurement(s) priced · ${cost.rateKinds.join(", ")}`;
    case "local_free":
      return "declared-free local model";
    case "partial":
      return `${cost.pricedMeasurements} of ${cost.measurements} priced · no rate for: ${cost.unpricedModels.join(", ")}`;
    case "unpriced":
      return `${cost.measurements} measurement(s) with no rate in the card`;
    default:
      return "no agent reported tokens; absence is not zero";
  }
}

export function formatReproCost(cost: ReproCost): string {
  return cost.totalUsd === null ? "unavailable" : `$${cost.totalUsd.toFixed(4)} USD`;
}

// ---------------------------------------------------------------- rounds

export type ReproRound = {
  iteration: number;
  phase: string;
  status: string;
  verdict: string | null;
  runtime: string | null;
  isFallback: boolean;
};

/** The step shape the daemon's orchestrator status reports. Every field is
 *  optional because an older daemon may omit one; nothing here is inferred. */
export type OrchestratorStep = {
  iteration?: number;
  phase?: string;
  status?: string;
  verdict?: string | null;
  isFallback?: boolean;
  runtime?: { harness?: string; model?: string } | null;
};

/** The rounds a run has actually reached, exactly as the daemon records
 *  them — the UI never infers a round that has not been observed. */
export function roundsOf(
  run: { steps?: OrchestratorStep[] } | null | undefined,
): ReproRound[] {
  return (run?.steps ?? []).map((step) => ({
    iteration: step.iteration ?? 0,
    phase: step.phase ?? "—",
    status: step.status ?? "—",
    verdict: step.verdict ?? null,
    runtime: step.runtime
      ? `${step.runtime.harness ?? "—"}/${step.runtime.model ?? "—"}`
      : null,
    isFallback: step.isFallback === true,
  }));
}

/** The workflow states that mean "stop polling". `unverifiable` is its own
 *  outcome: loss of contact is never read as either pass or fail. */
export const REPRO_TERMINAL_STATUSES = [
  "passed",
  "exhausted",
  "failed",
  "stopped",
  "unverifiable",
] as const;

export function isTerminalWorkflowStatus(status: string | undefined): boolean {
  return REPRO_TERMINAL_STATUSES.includes(
    (status ?? "") as (typeof REPRO_TERMINAL_STATUSES)[number],
  );
}

export function describeWorkflowStatus(status: string | undefined): string {
  switch (status) {
    case "passed":
      return "Passed: the result survived the rounds.";
    case "exhausted":
      return "Stopped at the round cap, still failing.";
    case "failed":
      return "Failed: no configured runtime could execute a role.";
    case "stopped":
      return "Stopped.";
    case "unverifiable":
      return "Unverifiable: contact was lost, and nothing is assumed.";
    default:
      return "Running.";
  }
}
