// Runs the reproducible demo from Settings, through the bridges the product
// already exposes: a Quick Session workspace of its own, a bot with a file
// watch over the spec, the spec change that wakes it, and the bounded
// adversarial rounds the daemon then drives.
//
// Every phase waits for something the DAEMON reports — a firing row, a run
// row, a terminal status — never for a timer. A phase that cannot be observed
// inside its bound fails with the reason, and the run continues where it
// honestly can (the receipt in the panel says which).

import { useCallback, useMemo, useRef, useState } from "react";

import type { Result } from "../../../../../shared/session-contract";
import type { OrchestratorStep } from "./repro-demo-plan";
import {
  REPRO_PHASES,
  initialPhaseStates,
  isTerminalWorkflowStatus,
  priceReproUsage,
  roundsOf,
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

type EvidenceEntry = {
  id: string;
  status: string;
  summary: string;
  detail?: string | null;
  role?: string | null;
  timestamp: string;
};

type UsageEntry = {
  role?: string | null;
  harness?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
};

type OrchestratorRun = {
  id: string;
  status?: string;
  iteration?: number;
  steps?: OrchestratorStep[];
};

/** Exactly the calls the demo makes. Narrow on purpose: the section can be
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
  }) => Promise<Result<{ monitorId: string; ruleKind: string; responsibilityId?: string | null }>>;
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

export type ReproDemoState = {
  running: boolean;
  phases: Record<ReproPhaseId, ReproPhaseState>;
  /** The widget the viewer should be looking at right now. */
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

function initialState(): ReproDemoState {
  return {
    running: false,
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

export type ReproDemoOptions = {
  runtime: ReproRuntimeChoice;
  iterations: number;
};

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
const ROUNDS_TIMEOUT_MS = 30 * 60_000;
const POLL_MS = 1500;

export function useReproDemo(
  bridge: ReproDemoBridge | null,
  options: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
) {
  const [state, setState] = useState<ReproDemoState>(initialState);
  const cancelled = useRef(false);
  const sleep = useMemo(
    () =>
      options.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    [options.sleep],
  );
  const now = useMemo(() => options.now ?? (() => Date.now()), [options.now]);

  const patch = useCallback((next: Partial<ReproDemoState>) => {
    setState((previous) => ({ ...previous, ...next }));
  }, []);

  const setPhase = useCallback(
    (id: ReproPhaseId, status: ReproPhaseState["status"], note: string | null = null) => {
      setState((previous) => ({
        ...previous,
        spotlight: status === "running" ? id : previous.spotlight === id && status !== "failed" ? id : previous.spotlight,
        phases: { ...previous.phases, [id]: { status, note } },
      }));
    },
    [],
  );

  const cancel = useCallback(() => {
    cancelled.current = true;
    patch({ running: false });
  }, [patch]);

  const run = useCallback(
    async ({ runtime, iterations }: ReproDemoOptions) => {
      if (!bridge) return;
      cancelled.current = false;
      setState({ ...initialState(), running: true });

      const until = async <T>(
        check: () => Promise<T | null>,
        label: string,
        timeoutMs: number,
      ): Promise<T> => {
        const deadline = now() + timeoutMs;
        for (;;) {
          if (cancelled.current) throw new Error("la demo se canceló");
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
        const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
        const quick = unwrap(
          await bridge.quickSessionCreate({ name: `dog-tinder-demo-${stamp}` }),
          "quickSessionCreate",
        );
        const workspaceId = quick.workspaceId;
        patch({ workspaceId, projectName: quick.project.name });
        setPhase("workspace", "done", quick.project.name);

        // Phase 2 — the seed: profiles, the test contract, and the exact node
        // the released session will start.
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
        const botId = `dog-tinder-demo-${stamp}`;
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
        patch({ botId: bot.id ?? botId });
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
        patch({ monitorId: monitor.monitorId });
        setPhase("watch", "done", `${monitor.ruleKind} · ${REPRO_SCENARIO_SPEC_PATH}`);

        const readMonitor = async (): Promise<MonitorView | null> => {
          const listed = await bridge.botMonitorList({
            hostId,
            workspaceId,
            botId: bot.id ?? botId,
          });
          if (!listed.ok) return null;
          return (
            listed.result.monitors.find(
              (entry) => entry.monitorId === monitor.monitorId,
            ) ?? null
          );
        };

        // Phase 6 — the change. First the watch reports the spec is absent;
        // then the demo writes it.
        setPhase("spec", "running", "esperando el primer chequeo del monitor");
        const first = await until(
          async () => {
            const view = await readMonitor();
            return view?.lastCheckOutcome ? view : null;
          },
          "el monitor no llegó a hacer su primer chequeo",
          FIRING_TIMEOUT_MS,
        );
        setState((previous) => ({
          ...previous,
          checks: [
            ...previous.checks,
            {
              outcome: first.lastCheckOutcome ?? "—",
              eventId: first.lastEventId ?? null,
              error: first.lastError ?? null,
              firing: first.firing?.lastOutcome ?? null,
            },
          ],
        }));
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
              setState((previous) => {
                const last = previous.checks.at(-1);
                const outcome = view.lastCheckOutcome ?? "—";
                const eventId = view.lastEventId ?? null;
                const firing = view.firing?.lastOutcome ?? null;
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
          patch({ firingEventId: fired.lastEventId ?? null });
          setPhase("firing", "done", `${fired.lastEventId} · ${fired.lastOutcome}`);

          const started = await until(
            async () => {
              const status = await bridge.graphOrchestratorStatus({ workspaceId });
              return status.ok && status.result.run?.id ? status.result.run : null;
            },
            "la sesión liberada no arrancó el workflow",
            WORKFLOW_START_TIMEOUT_MS,
          );
          patch({
            workflowId: started.id,
            releasedBy: "monitor",
            releaseNote: `Disparo ${fired.lastEventId}`,
          });
        } catch (error) {
          // The watch is real evidence either way: record why it did not
          // release the work, then start the workflow from the panel so the
          // rest of the demo still shows what it is for.
          const message = error instanceof Error ? error.message : String(error);
          setPhase("firing", "failed", message);
          const started = unwrap(
            await bridge.graphOrchestratorStart({
              workspaceId,
              main: mainNodeFor(runtime, REPRO_SCENARIO_SPEC),
            }),
            "graphOrchestratorStart",
          );
          patch({
            workflowId: started.run.id,
            releasedBy: "panel",
            releaseNote: message,
          });
        }

        // Phase 8 — the rounds, exactly as the daemon observes them.
        setPhase("rounds", "running");
        const finished = await until(
          async () => {
            const status = await bridge.graphOrchestratorStatus({ workspaceId });
            if (!status.ok || !status.result.run) return null;
            const run = status.result.run;
            setState((previous) => ({
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

        // Phase 9 — the ledgers and the cost of what ran.
        setPhase("evidence", "running");
        const snapshot = unwrap(
          await bridge.graphObservabilityStatus({ workspaceId }),
          "graphObservabilityStatus",
        );
        const usage = snapshot.observability.usage ?? [];
        patch({
          evidence: snapshot.observability.evidence ?? [],
          usage,
          cost: priceReproUsage(usage),
        });
        setPhase(
          "evidence",
          "done",
          `${(snapshot.observability.evidence ?? []).length} checkpoints`,
        );
        patch({ running: false, spotlight: "evidence" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setState((previous) => {
          const phases = { ...previous.phases };
          for (const phase of REPRO_PHASES) {
            if (phases[phase.id].status === "running")
              phases[phase.id] = { status: "failed", note: message };
          }
          return { ...previous, phases, running: false, failure: message };
        });
      }
    },
    [bridge, now, patch, setPhase, sleep],
  );

  return { state, run, cancel };
}
