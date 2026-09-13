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
    title: "Workspace desechable",
    detail: "Un proyecto Quick Session propio: nada toca tus repos.",
  },
  {
    id: "seed",
    title: "Repo semilla",
    detail: "Perfiles y el contrato de tests que el trabajo tiene que pasar.",
  },
  {
    id: "bot",
    title: "Bot",
    detail: "Con el harness y el modelo que elegiste arriba.",
  },
  {
    id: "policy",
    title: "Política del Work Graph",
    detail: "Runtimes aprobados y testing adversarial acotado.",
  },
  {
    id: "watch",
    title: "Monitor sobre el spec",
    detail: "Un watch de digest de archivo, aprobado por su hash exacto.",
  },
  {
    id: "spec",
    title: "El spec cambia",
    detail: "La demo escribe specs/dog-tinder.md: eso es lo que el bot verá.",
  },
  {
    id: "firing",
    title: "El bot despierta",
    detail: "El monitor observa el cambio y libera trabajo real.",
  },
  {
    id: "rounds",
    title: "Rondas adversariales",
    detail: "Implementar, romper, corregir y verificar, hasta el tope.",
  },
  {
    id: "evidence",
    title: "Evidencia y costo",
    detail: "Los ledgers de .drogon y el costo de lo que corrió.",
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

/** One selectable runtime. The free local Pi lane is first because it is the
 *  one that costs nothing; every entry names an exact model id, never a
 *  family, so nothing is ever guessed at launch. */
export type ReproRuntimeChoice = {
  id: string;
  harness: string;
  model: string;
  label: string;
  note: string;
  /** True when the provider bills nothing for this model on this host. */
  free: boolean;
};

export const REPRO_RUNTIME_CHOICES: readonly ReproRuntimeChoice[] = [
  {
    id: "pi-dgx-spark-qwen",
    harness: "pi",
    model: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
    label: "Pi · dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
    note: "Modelo local, sin facturación. El que usamos para probar.",
    free: true,
  },
  {
    id: "claude",
    harness: "claude",
    model: "",
    label: "Claude Code · modelo por defecto del harness",
    note: "Usa tu sesión de Claude Code instalada; el proveedor factura.",
    free: false,
  },
  {
    id: "codex",
    harness: "codex",
    model: "",
    label: "Codex · modelo por defecto del harness",
    note: "Usa tu Codex instalado; el proveedor factura.",
    free: false,
  },
  {
    id: "opencode",
    harness: "opencode",
    model: "",
    label: "OpenCode · elegí el id exacto",
    note: "OpenCode necesita un id `proveedor/modelo` explícito.",
    free: false,
  },
];

export const DEFAULT_REPRO_RUNTIME = REPRO_RUNTIME_CHOICES[0];

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
  "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4": {
    kind: "local_free",
    label: "modelo local, sin facturación",
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  "qwen3.8-flash-next-nvidia-nvfp4": {
    kind: "local_free",
    label: "modelo local, sin facturación",
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  "fixture/dog-tinder": {
    kind: "demo_rate",
    label: "tarifa de demostración",
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "dog-tinder": {
    kind: "demo_rate",
    label: "tarifa de demostración",
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
      return `${cost.pricedMeasurements} medición(es) tarifadas · ${cost.rateKinds.join(", ")}`;
    case "local_free":
      return "modelo local declarado sin facturación";
    case "partial":
      return `${cost.pricedMeasurements} de ${cost.measurements} tarifadas · sin tarifa: ${cost.unpricedModels.join(", ")}`;
    case "unpriced":
      return `${cost.measurements} medición(es) sin tarifa en la tabla`;
    default:
      return "ningún agente reportó tokens; la ausencia no es cero";
  }
}

export function formatReproCost(cost: ReproCost): string {
  return cost.totalUsd === null ? "no disponible" : `$${cost.totalUsd.toFixed(4)} USD`;
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
      return "Pasó: el resultado sobrevivió las rondas.";
    case "exhausted":
      return "Se agotó el tope de rondas y seguía fallando.";
    case "failed":
      return "Falló: ningún runtime configurado pudo ejecutar un rol.";
    case "stopped":
      return "Detenido.";
    case "unverifiable":
      return "Sin verificar: se perdió el contacto, no se asume nada.";
    default:
      return "Corriendo.";
  }
}
