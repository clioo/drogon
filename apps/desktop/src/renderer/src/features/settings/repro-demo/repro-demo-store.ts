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
  type ReproRuntime,
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
  projectCreate: (input: { name: string }) => Promise<
    Result<{ project: { id: string; name: string; path?: string }; workspaceId: string }>
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

  /** Housekeeping for the runs this demo leaves behind. Optional: a build
   *  without them still runs the demo, it just cannot tidy up after it. */
  botSnapshot?: (input: { hostId: string; workspaceId: string; locale: string }) => Promise<
    Result<{ bots: { id: string; displayIdentity: { handle: string | null } }[] }>
  >;
  botDelete?: (input: {
    hostId: string;
    workspaceId: string;
    requestId: string;
    botId: string;
  }) => Promise<Result<unknown>>;
  projectList?: () => Promise<
    Result<{ projects: { id: string; name: string; quickSession?: boolean }[] }>
  >;
  projectRemove?: (input: { id: string; deleteFiles?: boolean }) => Promise<Result<unknown>>;
};

export type ReproDemoState = {
  running: boolean;
  /** What the last run was started with, so the controls show what actually
   *  ran when the panel is reopened after the tour — not their defaults. */
  selection: {
    harness: string;
    model: string;
    subagents: ReproRuntime;
    iterations: number;
  } | null;
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
  /** The main agent's runtime: the bot's harness, and the released session. */
  runtime: ReproRuntime;
  /** Where the subagents run — the workers the main session dispatches and
   *  the daemon's test and review agents. The main runtime when omitted. */
  subagents?: ReproRuntime;
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

export function describeRuntime(runtime: ReproRuntime): string {
  return runtime.model ? `${runtime.harness}/${runtime.model}` : `${runtime.harness} (harness default)`;
}

/** Standing instructions for the reactive responsibility the watch releases.
 *  The daemon's delegation prompt tells the session to open a worktree; these
 *  say to work right here instead. The released session is the run's main
 *  agent: it fans the build out to parallel workers through Drogon's own
 *  orchestration verbs (the same ones the product's delegation guide names),
 *  waits for their reports, and only then hands the bounded adversarial
 *  workflow to the daemon — with one exact command, so even a small local
 *  model can follow it literally. */
export function releaseInstructions(workspaceId: string): string {
  return [
    "The Dog Tinder spec changed in this very workspace, and you are this run's main agent.",
    "Do not implement the deck yourself: delegate the build to parallel workers, then let the Work Graph test and review it.",
    "Ignore step 1 of the message (no new worktree is needed): work in this workspace, whose id is " + workspaceId + ".",
    "1. Read the delegation guide: drogon-cli skills get --topic orchestration",
    "2. Create the run: drogon-cli orchestration run-create --objective \"Dog Tinder: deck and page, built in parallel\" --host <the hostId that drogon-cli status prints>. Keep the runId, coordinatorId and consumerGeneration it returns: every orchestration command below takes --run <runId> --coordinator-id <coordinatorId> --consumer-generation <consumerGeneration>.",
    "3. Create two tasks with drogon-cli orchestration task-create ... --spec <text> --task-title <title>: \"[deck] Implement src/deck.js and src/storage.js per specs/dog-tinder.md. You cannot dispatch another worker.\" titled \"Deck and storage\", and \"[page] Implement index.html per specs/dog-tinder.md. You cannot dispatch another worker.\" titled \"Deck page\".",
    "4. Start one worker per task, both at once, in THIS workspace: drogon-cli orchestration worker-start ... --task <taskId> --workspace " + workspaceId + " --timeout-ms 900000. Workers run on the subagent runtime the Work Graph policy approves; do not start them any other way.",
    "5. Wait until both workers have reported: drogon-cli orchestration worker-show ... --dispatch <dispatchId> shows an outcome for each (or drogon-cli orchestration check --wait).",
    `6. Then run exactly this and finish: drogon-cli graph orchestrator-start --workspace ${workspaceId} --file .drogon/repro-main-node.json`,
    "7. Record one checkpoint with drogon-cli graph evidence-add --workspace " + workspaceId + " --status completed --summary <what the workers built> and exit.",
  ].join("\n");
}

export function mainNodeFor(runtime: ReproRuntime, spec: string) {
  return {
    id: "orchestrator-main",
    title: "Dog Tinder with undo of the last swipe",
    harness: runtime.harness,
    model: runtime.model,
    dependsOn: [] as string[],
    enabled: true,
    prompt: `${spec}\n\n${REPRO_SCENARIO_BRIEF}`,
  };
}

export function policyFor(runtime: ReproRuntime, iterations: number) {
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
  { runtime, subagents, iterations }: ReproDemoOptions,
  deps: ReproDemoDeps = {},
): Promise<void> {
  const workers = subagents ?? runtime;
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
      harness: runtime.harness,
      model: runtime.model,
      subagents: workers,
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
      if (cancelled) throw new Error("the demo was cancelled");
      const value = await check();
      if (value) return value;
      if (now() > deadline)
        throw new Error(`${label} (${Math.round(timeoutMs / 1000)}s)`);
      await sleep(POLL_MS);
    }
  };

  try {
    const { hostId } = unwrap(await bridge.status(), "status");

    // Phase 1 — a project of the demo's own, listed under Projects like any
    // other (a Quick Session would file it under Chats, next to the bot).
    setPhase("workspace", "running");
    const tag = shortToken();
    const created = unwrap(
      await bridge.projectCreate({ name: `dog-tinder-${tag}` }),
      "projectCreate",
    );
    const workspaceId = created.workspaceId;
    update({ workspaceId, projectName: created.project.name });
    setPhase("workspace", "done", created.project.name);

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
    setPhase("seed", "done", `${REPRO_SCENARIO_SEED.length + 1} files`);

    // Phase 3 — the bot that owns the watch and delegates the work. It lives
    // under Chats, so its name says what it is, not what it builds.
    setPhase("bot", "running");
    const botId = `white-walker-${tag}`;
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
            displayName: `White walker ${tag}`,
            // The handle is an identity, not a label: a fixed one makes the
            // SECOND run collide with the first ("handle is already owned").
            handle: `white-walker-${tag}`,
            title: "Delegates the Dog Tinder build",
          },
          harnessPolicy: {
            defaultHarness: runtime.harness,
            explicitModel: runtime.model || null,
          },
          instructions: REPRO_SCENARIO_BRIEF,
          memories: [
            "This run is a reproducible demonstration; none of it is production.",
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
        policy: policyFor(workers, iterations),
        main: mainNodeFor(runtime, REPRO_SCENARIO_SPEC),
      }),
      "graphWritePolicy",
    );
    setPhase(
      "policy",
      "done",
      `main ${describeRuntime(runtime)} · subagents ${describeRuntime(workers)} · ${iterations} round(s)`,
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
        responsibilityName: "Dog Tinder adversarial rounds",
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
    // The bot and its watch exist now, so show them: Bots is where a human
    // reads what this demo just configured, and the run keeps going behind it.
    // A beat first — the setup rows above are worth reading before the panel
    // gives way (and `sleep` is injected, so tests pay nothing for it).
    await sleep(2500);
    tour({ kind: "open-bots", workspaceId });

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
    setPhase("spec", "running", "waiting for the watch to check once");
    const first = await until(
      async () => {
        const view = await readMonitor();
        return view?.lastCheckOutcome ? view : null;
      },
      "the watch never ran its first check",
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
    setPhase("firing", "running", "the watch checks every minute");
    try {
      const fired = await until(
        async () => {
          const view = await readMonitor();
          if (!view) return null;
          recordCheck(view);
          return view.firing?.lastEventId ? view.firing : null;
        },
        "the watch never fired on the spec change",
        FIRING_TIMEOUT_MS,
      );
      if (fired.lastOutcome !== "dispatched" && fired.lastOutcome !== "joined") {
        throw new Error(
          `the firing released no work (${fired.lastOutcome}): ${fired.lastDetail ?? "no detail"}`,
        );
      }
      update({ firingEventId: fired.lastEventId ?? null });
      setPhase("firing", "done", `${fired.lastEventId} · ${fired.lastOutcome}`);
      // The released session exists now, and the first thing it does is fan
      // the build out to parallel workers — so this is the moment to leave
      // Settings for the run's own sessions: the main session and its workers,
      // side by side as they run. The Work Graph canvas stays a tab away; it
      // is a diagram, not the work.
      tour({ kind: "open-sessions", workspaceId });

      const started = await until(
        async () => {
          const status = await bridge.graphOrchestratorStatus({ workspaceId });
          return status.ok && status.result.run?.id ? status.result.run : null;
        },
        "the released session never started the workflow",
        WORKFLOW_START_TIMEOUT_MS,
      );
      update({
        workflowId: started.id,
        releasedBy: "monitor",
        releaseNote: `Firing ${fired.lastEventId}`,
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
      // Released by the panel instead: the daemon's rounds still run as
      // sessions in this workspace, so the tour goes there all the same.
      tour({ kind: "open-sessions", workspaceId });
    }

    // Phase 8 — the rounds, followed from the sessions view the tour opened
    // at the firing; the daemon's own status is what settles them.
    setPhase("rounds", "running");
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
      "the workflow never finished",
      ROUNDS_TIMEOUT_MS,
    );
    setPhase(
      "rounds",
      finished.status === "passed" ? "done" : "failed",
      finished.status ?? null,
    );

    // Phase 9 — the telemetry and the cost, on the Work Graph's own tabs.
    setPhase("evidence", "running");
    tour({ kind: "open-work-graph", workspaceId });
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
      `${(snapshot.observability.evidence ?? []).length} telemetry entries`,
    );
    // The telemetry is worth reading before the tour's last stop, the usage.
    await sleep(8000);
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

/** The identities this demo mints: its bots' handles and its projects'
 *  names, across every version of the demo that ever ran here. Nothing
 *  else is ever touched by the cleanup. */
export const DEMO_BOT_HANDLE = /^(white-walker|dog-tinder)-[0-9a-f]{4,6}$/;
export const DEMO_PROJECT_NAME = /^dog-tinder-(demo-\d+|[0-9a-f]{6})$/;

export type ReproCleanupReport = { bots: number; projects: number; errors: string[] };

export function canRemoveDemoRuns(bridge: ReproDemoBridge | null): boolean {
  return Boolean(
    bridge?.botSnapshot && bridge.botDelete && bridge.projectList && bridge.projectRemove,
  );
}

/** Removes every bot and project this demo created — and only those: the
 *  bots whose handle is a demo handle, the projects whose name is a demo
 *  name. Projects go with their folder when the daemon created the folder
 *  (a Quick Session's scratch, or `projectCreate`'s home); a failure on one
 *  item is reported and the rest still proceeds. Never runs mid-demo. */
export async function removeDemoRuns(bridge: ReproDemoBridge | null): Promise<ReproCleanupReport> {
  const report: ReproCleanupReport = { bots: 0, projects: 0, errors: [] };
  if (!bridge || !canRemoveDemoRuns(bridge) || state.running) return report;
  const status = await bridge.status();
  if (!status.ok) {
    report.errors.push(`status: ${status.error.message}`);
    return report;
  }
  const hostId = status.result.hostId;
  const bots = await bridge.botSnapshot!({ hostId, workspaceId: "", locale: "en-US" });
  if (!bots.ok) report.errors.push(`bots: ${bots.error.message}`);
  else {
    for (const bot of bots.result.bots) {
      if (!DEMO_BOT_HANDLE.test(bot.displayIdentity.handle ?? "")) continue;
      const removed = await bridge.botDelete!({
        hostId,
        workspaceId: "",
        requestId: requestId(),
        botId: bot.id,
      });
      if (removed.ok) report.bots += 1;
      else report.errors.push(`bot ${bot.displayIdentity.handle}: ${removed.error.message}`);
    }
  }
  const projects = await bridge.projectList!();
  if (!projects.ok) report.errors.push(`projects: ${projects.error.message}`);
  else {
    for (const project of projects.result.projects) {
      if (!DEMO_PROJECT_NAME.test(project.name)) continue;
      const removed = await bridge.projectRemove!({ id: project.id, deleteFiles: true });
      if (removed.ok) report.projects += 1;
      else report.errors.push(`project ${project.name}: ${removed.error.message}`);
    }
  }
  return report;
}
