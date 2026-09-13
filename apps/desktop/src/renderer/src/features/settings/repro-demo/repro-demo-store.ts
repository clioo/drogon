// The demo's run state, kept OUTSIDE React on purpose.
//
// The tour takes the viewer out of Settings to the Work Graph while the run is
// still going, which unmounts the panel. A run whose state lived in that
// component would lose everything at exactly the moment it gets interesting;
// here the panel is a view over a store that outlives it, so coming back to
// Settings shows the run as it stands.
//
// Every phase waits for something the DAEMON reports — a firing row, a run
// row, a terminal status — never for a timer. A phase that cannot be observed
// inside its bound fails with the reason, and the run continues where it
// honestly can (the panel says which).

import type { Result } from "../../../../../shared/session-contract";
import {
  requestReproTour,
  type ReproTourSink,
} from "../../../repro-demo-tour";
import {
  REPRO_PHASES,
  initialPhaseStates,
  isTerminalWorkflowStatus,
  priceReproUsage,
  roundsOf,
  type OrchestratorStep,
  type ReproCost,
  type ReproPhaseId,
  type ReproPhaseState,
  type ReproRound,
  type ReproRuntimeChoice,
} from "./repro-demo-plan";
import {
  REPRO_SCENARIO_BRIEF,
  REPRO_SCENARIO_SEED,
  REPRO_SCENARIO_SPEC,
  REPRO_SCENARIO_SPEC_PATH,
} from "./repro-demo-scenario";

export type EvidenceEntry = {
  id: string;
  status: string;
  summary: string;
  detail?: string | null;
  role?: string | null;
  timestamp: string;
};

export type UsageEntry = {
  role?: string | null;
  harness?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
};

export type OrchestratorRun = {
  id: string;
  status?: string;
  iteration?: number;
  steps?: OrchestratorStep[];
};

export type MonitorView = {
  monitorId: string;
  lastCheckOutcome?: string | null;
  lastEventId?: string | null;
  lastError?: string | null;
  firing?: {
    lastEventId?: string | null;
    lastOutcome?: string | null;
    lastDetail?: string | null;
  } | null;
};

export type MonitorCheck = {
  outcome: string;
  eventId: string | null;
  error: string | null;
  firing: string | null;
};

/** Exactly the calls the demo makes. Narrow on purpose: the panel can be
 *  driven by fakes in tests, and a build whose preload predates one of these
 *  reports the demo as unavailable instead of throwing at click time. */
export type ReproDemoBridge = {
  status: () => Promise<Result<{ hostId: string }>>;
  quickSessionCreate: (input: { name?: string }) => Promise<
    Result<{ project: { id: string; name: string }; workspaceId: string }>
  >;
  fileWrite: (input: {
    hostId: string;
    workspaceId: string;
    path: string;
    content: string;
    requestId: string;
  }) => Promise<Result<unknown>>;
  botCreate: (input: unknown) => Promise<Result<{ id: string }>>;
  botMonitorCreate: (input: {
    hostId: string;
    workspaceId: string;
    botId: string;
    resource: string;
    cron?: string;
    responsibilityName?: string;
    instructions?: string;
  }) => Promise<
    Result<{ monitorId: string; ruleKind: string; responsibilityId?: string | null }>
  >;
  botMonitorApprove: (input: {
    hostId: string;
    workspaceId: string;
    botId: string;
    monitorId: string;
  }) => Promise<Result<{ approved: boolean }>>;
  botMonitorList: (input: {
    hostId: string;
    workspaceId: string;
    botId: string;
  }) => Promise<Result<{ monitors: MonitorView[] }>>;
  graphWritePolicy: (input: unknown) => Promise<Result<unknown>>;
  graphOrchestratorStart: (input: unknown) => Promise<Result<{ run: OrchestratorRun }>>;
  graphOrchestratorStatus: (input: {
    workspaceId: string;
  }) => Promise<Result<{ run: OrchestratorRun | null }>>;
  graphObservabilityStatus: (input: { workspaceId: string }) => Promise<
    Result<{ observability: { evidence: EvidenceEntry[]; usage: UsageEntry[] } }>
  >;
};

export type ReproDemoState = {
  running: boolean;
  /** What the last run was started with, so the controls show what actually
   *  ran when the panel is reopened after the tour — not their defaults. */
  selection: { runtimeId: string; harness: string; model: string; iterations: number } | null;
  phases: Record<ReproPhaseId, ReproPhaseState>;
  /** The widget in the panel the viewer should be looking at right now. */
  spotlight: ReproPhaseId | null;
  workspaceId: string | null;
  projectName: string | null;
  botId: string | null;
  monitorId: string | null;
  checks: MonitorCheck[];
  firingEventId: string | null;
  releasedBy: "monitor" | "panel" | null;
  releaseNote: string | null;
  workflowId: string | null;
  workflowStatus: string | null;
  rounds: ReproRound[];
  evidence: EvidenceEntry[];
  usage: UsageEntry[];
  cost: ReproCost | null;
  failure: string | null;
};

export type ReproDemoOptions = {
  runtime: ReproRuntimeChoice;
  iterations: number;
};

export type ReproDemoDeps = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  tour?: ReproTourSink;
};

function initialState(): ReproDemoState {
  return {
    running: false,
    selection: null,
    phases: initialPhaseStates(),
    spotlight: null,
    workspaceId: null,
    projectName: null,
    botId: null,
    monitorId: null,
    checks: [],
    firingEventId: null,
    releasedBy: null,
    releaseNote: null,
    workflowId: null,
    workflowStatus: null,
    rounds: [],
    evidence: [],
    usage: [],
    cost: null,
    failure: null,
  };
}

let state: ReproDemoState = initialState();
let cancelled = false;
const listeners = new Set<() => void>();

export function subscribeReproDemo(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getReproDemoState(): ReproDemoState {
  return state;
}

/** Test seam: the store outlives a component on purpose, so a suite must be
 *  able to start each case from nothing. */
export function resetReproDemo(): void {
  cancelled = true;
  state = initialState();
  for (const listener of listeners) listener();
}

function update(next: Partial<ReproDemoState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function mutate(producer: (previous: ReproDemoState) => ReproDemoState): void {
  state = producer(state);
  for (const listener of listeners) listener();
}

function setPhase(
  id: ReproPhaseId,
  status: ReproPhaseState["status"],
  note: string | null = null,
): void {
  mutate((previous) => ({
    ...previous,
    spotlight: status === "running" ? id : previous.spotlight,
    phases: { ...previous.phases, [id]: { status, note } },
  }));
}

export function cancelReproDemo(): void {
  cancelled = true;
  update({ running: false });
}

/** A short, readable tag for one run: enough to tell two demos apart at a
 *  glance in the sidebar, the Bots page and the Work Graph, and short enough
 *  to read out loud. Six hex characters from the CSPRNG, not a timestamp — two
 *  runs in the same second still get different names. */
function shortToken(): string {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const bytes = new Uint8Array(3);
    crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(16).slice(2, 8).padEnd(6, "0");
}

function requestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `repro-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function unwrap<T>(result: Result<T>, what: string): T {
  if (!result.ok) throw new Error(`${what}: ${result.error.message}`);
  return result.result;
}

/** Standing instructions for the reactive responsibility the watch releases.
 *  The daemon's delegation prompt tells the session to open a worktree; these
 *  say to work right here instead, with one exact command, so even a small
 *  local model can follow it literally. */
export function releaseInstructions(workspaceId: string): string {
  return [
    "El spec de Dog Tinder cambió en este mismo workspace.",
    "No implementes el deck vos: arrancá el workflow durable y dejá que el Work Graph lo haga.",
    "Ignorá el paso 1 del mensaje (no hace falta un worktree nuevo): trabajá en este workspace.",
    `Corré exactamente esto y terminá: drogon-cli graph orchestrator-start --workspace ${workspaceId} --file .drogon/repro-main-node.json`,
    "Después registrá un checkpoint con `drogon-cli graph evidence-add` y salí.",
  ].join("\n");
}

export function mainNodeFor(runtime: ReproRuntimeChoice, spec: string) {
  return {
    id: "orchestrator-main",
    title: "Dog Tinder con undo del último swipe",
    harness: runtime.harness,
    model: runtime.model,
    dependsOn: [] as string[],
    enabled: true,
    prompt: `${spec}\n\n${REPRO_SCENARIO_BRIEF}`,
  };
}

export function policyFor(runtime: ReproRuntimeChoice, iterations: number) {
  return {
    approvedRuntimes: [{ harness: runtime.harness, model: runtime.model }],
    adversarial: { enabled: true, maxIterations: iterations },
    delegate: false,
  };
}

const FIRING_TIMEOUT_MS = 300_000;
const WORKFLOW_START_TIMEOUT_MS = 180_000;
const ROUNDS_TIMEOUT_MS = 45 * 60_000;
const POLL_MS = 1500;

export async function runReproDemo(
  bridge: ReproDemoBridge | null,
  { runtime, iterations }: ReproDemoOptions,
  deps: ReproDemoDeps = {},
): Promise<void> {
  if (!bridge || state.running) return;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => Date.now());
  const tour = deps.tour ?? requestReproTour;

  cancelled = false;
  state = {
    ...initialState(),
    running: true,
    selection: {
      runtimeId: runtime.id,
      harness: runtime.harness,
      model: runtime.model,
      iterations,
    },
  };
  for (const listener of listeners) listener();

  const until = async <T>(
    check: () => Promise<T | null>,
    label: string,
    timeoutMs: number,
  ): Promise<T> => {
    const deadline = now() + timeoutMs;
    for (;;) {
      if (cancelled) throw new Error("la demo se canceló");
      const value = await check();
      if (value) return value;
      if (now() > deadline)
        throw new Error(`${label} (${Math.round(timeoutMs / 1000)}s)`);
      await sleep(POLL_MS);
    }
  };

  try {
    const { hostId } = unwrap(await bridge.status(), "status");

    // Phase 1 — a workspace of the demo's own.
    setPhase("workspace", "running");
    const tag = shortToken();
    const quick = unwrap(
      await bridge.quickSessionCreate({ name: `dog-tinder-${tag}` }),
      "quickSessionCreate",
    );
    const workspaceId = quick.workspaceId;
    update({ workspaceId, projectName: quick.project.name });
    setPhase("workspace", "done", quick.project.name);

    // Phase 2 — the seed: profiles, the test contract, and the exact node the
    // released session will start.
    setPhase("seed", "running");
    for (const file of REPRO_SCENARIO_SEED) {
      unwrap(
        await bridge.fileWrite({
          hostId,
          workspaceId,
          path: file.path,
          content: file.content,
          requestId: requestId(),
        }),
        `fileWrite ${file.path}`,
      );
    }
    unwrap(
      await bridge.fileWrite({
        hostId,
        workspaceId,
        path: ".drogon/repro-main-node.json",
        content: `${JSON.stringify(mainNodeFor(runtime, REPRO_SCENARIO_SPEC), null, 2)}\n`,
        requestId: requestId(),
      }),
      "fileWrite .drogon/repro-main-node.json",
    );
    setPhase("seed", "done", `${REPRO_SCENARIO_SEED.length + 1} archivos`);

    // Phase 3 — the bot that owns the watch.
    setPhase("bot", "running");
    const botId = `dog-tinder-${tag}`;
    const bot = unwrap(
      await bridge.botCreate({
        hostId,
        workspaceId,
        requestId: requestId(),
        botId,
        locale: "es-MX",
        body: {
          characterPreset: "arya",
          displayIdentity: {
            displayName: "Dog Tinder bot",
            handle: "dog-tinder-demo",
            title: "Vigila el spec del deck",
          },
          harnessPolicy: {
            defaultHarness: runtime.harness,
            explicitModel: runtime.model || null,
          },
          instructions: REPRO_SCENARIO_BRIEF,
          memories: [
            "Esta corrida es una demostración reproducible; nada de esto es producción.",
          ],
        },
      }),
      "botCreate",
    );
    update({ botId: bot.id ?? botId });
    setPhase("bot", "done", bot.id ?? botId);

    // Phase 4 — the Subagent policy, with the adversarial loop on.
    setPhase("policy", "running");
    unwrap(
      await bridge.graphWritePolicy({
        workspaceId,
        policy: policyFor(runtime, iterations),
        main: mainNodeFor(runtime, REPRO_SCENARIO_SPEC),
      }),
      "graphWritePolicy",
    );
    setPhase(
      "policy",
      "done",
      `${runtime.harness}${runtime.model ? `/${runtime.model}` : ""} · ${iterations} ronda(s)`,
    );

    // Phase 5 — the watch, armed while the spec does not exist yet, so the
    // firing is caused by the change the demo makes next.
    setPhase("watch", "running");
    const monitor = unwrap(
      await bridge.botMonitorCreate({
        hostId,
        workspaceId,
        botId: bot.id ?? botId,
        resource: REPRO_SCENARIO_SPEC_PATH,
        cron: "* * * * *",
        responsibilityName: "Rondas adversariales de Dog Tinder",
        instructions: releaseInstructions(workspaceId),
      }),
      "botMonitorCreate",
    );
    unwrap(
      await bridge.botMonitorApprove({
        hostId,
        workspaceId,
        botId: bot.id ?? botId,
        monitorId: monitor.monitorId,
      }),
      "botMonitorApprove",
    );
    update({ monitorId: monitor.monitorId });
    setPhase("watch", "done", `${monitor.ruleKind} · ${REPRO_SCENARIO_SPEC_PATH}`);

    const readMonitor = async (): Promise<MonitorView | null> => {
      const listed = await bridge.botMonitorList({
        hostId,
        workspaceId,
        botId: bot.id ?? botId,
      });
      if (!listed.ok) return null;
      return (
        listed.result.monitors.find((entry) => entry.monitorId === monitor.monitorId) ??
        null
      );
    };

    const recordCheck = (view: MonitorView): void => {
      mutate((previous) => {
        const outcome = view.lastCheckOutcome ?? "—";
        const eventId = view.lastEventId ?? null;
        const firing = view.firing?.lastOutcome ?? null;
        const last = previous.checks.at(-1);
        if (
          last &&
          last.outcome === outcome &&
          last.eventId === eventId &&
          last.firing === firing
        )
          return previous;
        return {
          ...previous,
          checks: [
            ...previous.checks,
            { outcome, eventId, error: view.lastError ?? null, firing },
          ],
        };
      });
    };

    // Phase 6 — the change. First the watch reports the spec is absent; then
    // the demo writes it.
    setPhase("spec", "running", "esperando el primer chequeo del monitor");
    const first = await until(
      async () => {
        const view = await readMonitor();
        return view?.lastCheckOutcome ? view : null;
      },
      "el monitor no llegó a hacer su primer chequeo",
      FIRING_TIMEOUT_MS,
    );
    recordCheck(first);
    unwrap(
      await bridge.fileWrite({
        hostId,
        workspaceId,
        path: REPRO_SCENARIO_SPEC_PATH,
        content: REPRO_SCENARIO_SPEC,
        requestId: requestId(),
      }),
      `fileWrite ${REPRO_SCENARIO_SPEC_PATH}`,
    );
    setPhase("spec", "done", REPRO_SCENARIO_SPEC_PATH);

    // Phase 7 — the bot wakes itself up.
    setPhase("firing", "running", "el monitor chequea cada minuto");
    try {
      const fired = await until(
        async () => {
          const view = await readMonitor();
          if (!view) return null;
          recordCheck(view);
          return view.firing?.lastEventId ? view.firing : null;
        },
        "el monitor no disparó sobre el cambio del spec",
        FIRING_TIMEOUT_MS,
      );
      if (fired.lastOutcome !== "dispatched" && fired.lastOutcome !== "joined") {
        throw new Error(
          `el disparo no liberó trabajo (${fired.lastOutcome}): ${fired.lastDetail ?? "sin detalle"}`,
        );
      }
      update({ firingEventId: fired.lastEventId ?? null });
      setPhase("firing", "done", `${fired.lastEventId} · ${fired.lastOutcome}`);

      const started = await until(
        async () => {
          const status = await bridge.graphOrchestratorStatus({ workspaceId });
          return status.ok && status.result.run?.id ? status.result.run : null;
        },
        "la sesión liberada no arrancó el workflow",
        WORKFLOW_START_TIMEOUT_MS,
      );
      update({
        workflowId: started.id,
        releasedBy: "monitor",
        releaseNote: `Disparo ${fired.lastEventId}`,
      });
    } catch (error) {
      // The watch is real evidence either way: record why it did not release
      // the work, then start the workflow from the panel so the rest of the
      // demo still shows what it is for.
      const message = error instanceof Error ? error.message : String(error);
      setPhase("firing", "failed", message);
      const started = unwrap(
        await bridge.graphOrchestratorStart({
          workspaceId,
          main: mainNodeFor(runtime, REPRO_SCENARIO_SPEC),
        }),
        "graphOrchestratorStart",
      );
      update({
        workflowId: started.run.id,
        releasedBy: "panel",
        releaseNote: message,
      });
    }

    // Phase 8 — the rounds. This is the moment worth watching, so the tour
    // leaves Settings and opens the workspace's own Work Graph: from here the
    // viewer follows the real orchestrator canvas, not a copy of it.
    setPhase("rounds", "running");
    tour({ kind: "open-work-graph", workspaceId });
    tour({ kind: "focus-view", view: "graph" });
    const finished = await until(
      async () => {
        const status = await bridge.graphOrchestratorStatus({ workspaceId });
        if (!status.ok || !status.result.run) return null;
        const run = status.result.run;
        mutate((previous) => ({
          ...previous,
          workflowStatus: run.status ?? null,
          rounds: roundsOf(run),
        }));
        return isTerminalWorkflowStatus(run.status) ? run : null;
      },
      "el workflow no terminó",
      ROUNDS_TIMEOUT_MS,
    );
    setPhase(
      "rounds",
      finished.status === "passed" ? "done" : "failed",
      finished.status ?? null,
    );

    // Phase 9 — the ledgers and the cost, on the product's own tabs.
    setPhase("evidence", "running");
    tour({ kind: "focus-view", view: "evidence" });
    const snapshot = unwrap(
      await bridge.graphObservabilityStatus({ workspaceId }),
      "graphObservabilityStatus",
    );
    const usage = snapshot.observability.usage ?? [];
    update({
      evidence: snapshot.observability.evidence ?? [],
      usage,
      cost: priceReproUsage(usage),
    });
    setPhase(
      "evidence",
      "done",
      `${(snapshot.observability.evidence ?? []).length} checkpoints`,
    );
    tour({ kind: "focus-view", view: "usage" });
    update({ running: false, spotlight: "evidence" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    mutate((previous) => {
      const phases = { ...previous.phases };
      for (const phase of REPRO_PHASES) {
        if (phases[phase.id].status === "running")
          phases[phase.id] = { status: "failed", note: message };
      }
      return { ...previous, phases, running: false, failure: message };
    });
  }
}
