// The demo's run state, kept OUTSIDE React on purpose.
//
// The demo closes Settings once its Bot session exists, which unmounts the
// panel. A run whose state lived in that component would lose everything at
// exactly the moment it gets interesting; here the panel is a view over a
// store that outlives it, so coming back to Settings shows the run as it
// stands. After that first handoff the viewer owns navigation: the demo never
// pulls them away from the Bot, main-agent, or worker session they opened.
//
// The chain is short on purpose: a project, a bot under Chats on the harness
// the viewer picked, the task sent to that bot's own session, the Work Graph
// the bot admits (its main session fans out to parallel workers), the
// daemon's adversarial rounds, and the telemetry. No watch, no cron, no
// scheduler in between: every wait is for something the DAEMON reports — a
// dispatch receipt, a workflow row, a terminal status — never for a timer.

import type { Result } from "../../../../../shared/session-contract";
import { buildBotRunHarness } from "../../bots/bots-page-model";
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

/** What `bot.run` answers for a chat turn: the session it admitted, or why
 *  it did not. Narrowed to the fields the demo reads. */
export type BotRunReceiptView = {
  outcome: "dispatched" | "refused" | "unsupported" | string;
  session: { sessionId: string; incarnation: string } | null;
  error?: string | null;
  workspaceId?: string;
};

export type SessionView = {
  id: string;
  verdict: string;
  exitCode?: number | null;
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
  /** A chat turn: the prompt goes to a headless session of the bot's own,
   *  on the harness overrides given, and the receipt names that session. */
  botRun: (input: unknown) => Promise<Result<BotRunReceiptView>>;
  graphWritePolicy: (input: unknown) => Promise<Result<unknown>>;
  graphOrchestratorStart: (input: unknown) => Promise<Result<{ run: OrchestratorRun }>>;
  graphOrchestratorStatus: (input: {
    workspaceId: string;
  }) => Promise<Result<{ run: OrchestratorRun | null }>>;
  graphObservabilityStatus: (input: { workspaceId: string }) => Promise<
    Result<{ observability: { evidence: EvidenceEntry[]; usage: UsageEntry[] } }>
  >;

  /** The workspace's sessions, as the daemon lists them. Optional: with it
   *  the demo can tell a bot session that EXITED without admitting the
   *  workflow from one still working, and admit the workflow itself (saying
   *  so) instead of waiting out the whole budget. */
  sessionList?: (input: { workspaceId: string }) => Promise<Result<{ sessions: SessionView[] }>>;

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
  /** The bot's own session, the one the prompt went to. */
  dispatch: { sessionId: string; incarnation: string } | null;
  /** Who admitted the workflow: the bot's session, as intended, or this
   *  panel after that session provably exited without doing it. */
  releasedBy: "bot" | "panel" | null;
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
    dispatch: null,
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
let generation = 0;
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
  generation += 1;
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
  // Keep admission closed until the in-flight operation has settled.
  update({ failure: "Stopping the tour. Already-started sessions keep running." });
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

/** The file the bot's dispatch names: the main node, exactly as the policy
 *  phase wrote it into the graph. */
export const REPRO_MAIN_NODE_PATH = ".drogon/repro-main-node.json";

/** What the bot IS, as its standing instructions: a dispatcher. It admits the
 *  graph; it does not become its main agent. Every command is spelled out
 *  with the real workspace id, so even a small model has nothing to infer. */
export function releaseInstructions(workspaceId: string): string {
  return [
    "You are the Bot dispatcher acting on behalf of the user, not this graph's main agent.",
    "Use this prepared workspace instead of creating another worktree: " + workspaceId + ". Its graph policy and main-node file are already configured; preserve them.",
    `Check drogon-cli graph orchestrator-status --workspace ${workspaceId} --json first. Reuse an existing run for this task; do not retry an active or unverifiable admission.`,
    `Dispatch exactly once: drogon-cli graph orchestrator-start --workspace ${workspaceId} --file ${REPRO_MAIN_NODE_PATH}`,
    "Report the returned graph run id and workspace, then end this Bot turn. Do not implement, start workers, wait for workers, or claim the graph completed.",
    "The graph's main agent plans and supervises its depth-one workers. The Bot is outside that depth budget.",
  ].join("\n");
}

/** The message the demo sends to the bot: the task, and the one action it
 *  takes on it. The concrete command is repeated here on purpose — a
 *  headless turn reads its standing instructions and this message together,
 *  and the command must be unmistakable in either. */
export function dispatchPrompt(workspaceId: string): string {
  return [
    REPRO_SCENARIO_BRIEF.trim(),
    "",
    `This task is ready to be admitted as a Work Graph in workspace ${workspaceId}: the spec is at ${REPRO_SCENARIO_SPEC_PATH}, the Subagent policy is saved, and the main node is at ${REPRO_MAIN_NODE_PATH}.`,
    `Run now, exactly once: drogon-cli graph orchestrator-start --workspace ${workspaceId} --file ${REPRO_MAIN_NODE_PATH}`,
    "Then report the run id it returns and end your turn. Do not build the deck yourself.",
  ].join("\n");
}

export function mainInstructions(workspaceId: string): string {
  return [
    "You are the main agent of the dispatched Dog Tinder graph, not the Bot that released it.",
    "Do not implement the deck yourself: coordinate parallel workers under the saved Subagent policy.",
    "1. Read the delegation guide: drogon-cli skills get --topic orchestration",
    "2. Create the run: drogon-cli orchestration run-create --objective \"Dog Tinder: deck and page, built in parallel\" --host <the hostId that drogon-cli status prints>. Keep the runId, coordinatorId and consumerGeneration it returns: every orchestration command below takes --run <runId> --coordinator-id <coordinatorId> --consumer-generation <consumerGeneration>.",
    "3. Create two tasks with drogon-cli orchestration task-create ... --spec <text> --task-title <title>: \"[deck] Implement src/deck.js and src/storage.js per specs/dog-tinder.md. You cannot dispatch another worker.\" titled \"Deck and storage\", and \"[page] Implement index.html per specs/dog-tinder.md. You cannot dispatch another worker.\" titled \"Deck page\".",
    "4. Start one worker per task, both at once, in THIS workspace: drogon-cli orchestration worker-start ... --task <taskId> --workspace " + workspaceId + " --timeout-ms 900000. Workers run on the subagent runtime the Work Graph policy approves; do not start them any other way.",
    "5. Wait for both workers IN THE FOREGROUND and do not end your turn while children are unfinished. Run drogon-cli orchestration check ... --wait --timeout-ms 600000 and repeat until worker_done arrives for both tasks; drogon-cli orchestration worker-show confirms each outcome. Follow the graph's policy for per-worker testing and corrections.",
    "6. Record the result with drogon-cli graph evidence-add --workspace " + workspaceId + " --status completed --summary <what the workers built> and exit. This graph is already running: do not start a second workflow. The daemon owns its final whole-workflow adversarial rounds.",
  ].join("\n");
}

export function mainNodeFor(runtime: ReproRuntime, spec: string, workspaceId: string) {
  return {
    id: "orchestrator-main",
    title: "Dog Tinder with undo of the last swipe",
    harness: runtime.harness,
    model: runtime.model,
    dependsOn: [] as string[],
    enabled: true,
    prompt: `${spec}\n\n${REPRO_SCENARIO_BRIEF}\n\n${mainInstructions(workspaceId)}`,
  };
}

export function policyFor(runtime: ReproRuntime, iterations: number) {
  return {
    approvedRuntimes: [{ harness: runtime.harness, model: runtime.model }],
    adversarial: { enabled: true, maxIterations: iterations },
    delegate: false,
  };
}

// A headless bot turn has to boot its harness and run one command. Ten
// minutes is generous; the bound exists so a hung harness is reported, not
// waited on forever. A bot session that EXITS without admitting anything is
// handled the moment it is observed, not at this deadline.
const WORKFLOW_START_TIMEOUT_MS = 10 * 60_000;
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

  const runGeneration = ++generation;
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

  const ensureFollowing = () => {
    if (cancelled || generation !== runGeneration)
      throw new Error("Tour stopped. Already-started sessions keep running.");
  };
  const until = async <T>(
    check: () => Promise<T | null>,
    label: string,
    timeoutMs: number,
  ): Promise<T> => {
    const deadline = now() + timeoutMs;
    for (;;) {
      ensureFollowing();
      const value = await check();
      ensureFollowing();
      if (value) return value;
      if (now() > deadline)
        throw new Error(`${label} (${Math.round(timeoutMs / 1000)}s)`);
      await sleep(POLL_MS);
    }
  };

  try {
    const { hostId } = unwrap(await bridge.status(), "status");
    ensureFollowing();

    // Phase 1 — a project of the demo's own, listed under Projects like any
    // other (a Quick Session would file it under Chats, next to the bot).
    setPhase("workspace", "running");
    const tag = shortToken();
    const created = unwrap(
      await bridge.projectCreate({ name: `dog-tinder-${tag}` }),
      "projectCreate",
    );
    ensureFollowing();
    const workspaceId = created.workspaceId;
    update({ workspaceId, projectName: created.project.name });
    setPhase("workspace", "done", created.project.name);

    // Phase 2 — the seed: the spec, the profiles, the test contract, and the
    // exact node the bot will admit.
    setPhase("seed", "running");
    const seed = [
      ...REPRO_SCENARIO_SEED,
      { path: REPRO_SCENARIO_SPEC_PATH, content: REPRO_SCENARIO_SPEC },
      {
        path: REPRO_MAIN_NODE_PATH,
        content: `${JSON.stringify(mainNodeFor(runtime, REPRO_SCENARIO_SPEC, workspaceId), null, 2)}\n`,
      },
    ];
    for (const file of seed) {
      ensureFollowing();
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
    setPhase("seed", "done", `${seed.length} files`);

    // Phase 3 — the bot that gets the task and delegates it. It lives under
    // Chats, so its name says what it is, not what it builds.
    ensureFollowing();
    setPhase("bot", "running");
    const botId = `white-walker-${tag}`;
    const bot = unwrap(
      await bridge.botCreate({
        hostId,
        workspaceId,
        requestId: requestId(),
        botId,
        locale: "en-US",
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
          instructions: releaseInstructions(workspaceId),
          memories: [
            "This run is a reproducible demonstration; none of it is production.",
          ],
        },
      }),
      "botCreate",
    );
    ensureFollowing();
    update({ botId: bot.id ?? botId });
    setPhase("bot", "done", bot.id ?? botId);

    // Phase 4 — the Subagent policy, with the adversarial loop on, and the
    // main node in the graph.
    ensureFollowing();
    setPhase("policy", "running");
    unwrap(
      await bridge.graphWritePolicy({
        workspaceId,
        policy: policyFor(workers, iterations),
        main: mainNodeFor(runtime, REPRO_SCENARIO_SPEC, workspaceId),
      }),
      "graphWritePolicy",
    );
    setPhase(
      "policy",
      "done",
      `main ${describeRuntime(runtime)} · subagents ${describeRuntime(workers)} · ${iterations} round(s)`,
    );

    // Phase 5 — the prompt. One chat turn to the bot, on the runtime the
    // viewer picked: a headless session of the bot's own, in this workspace.
    ensureFollowing();
    setPhase("prompt", "running");
    const receipt = unwrap(
      await bridge.botRun({
        hostId,
        workspaceId,
        botId: bot.id ?? botId,
        requestId: requestId(),
        locale: "en-US",
        prompt: dispatchPrompt(workspaceId),
        harness: buildBotRunHarness(runtime.harness, runtime.model || null),
      }),
      "botRun",
    );
    ensureFollowing();
    if (receipt.outcome !== "dispatched" || !receipt.session) {
      throw new Error(
        `the bot did not take the prompt (${receipt.outcome}): ${receipt.error ?? "no detail"}`,
      );
    }
    const dispatch = receipt.session;
    update({ dispatch });
    setPhase(
      "prompt",
      "done",
      `session ${dispatch.sessionId.slice(0, 8)} · ${describeRuntime(runtime)}`,
    );
    // The Bot session now exists. Close Settings into the ordinary app shell;
    // its row appears under Chats and one click opens that exact session. From
    // here on the demo never changes the viewer's route or selected session.
    await sleep(2500);
    ensureFollowing();
    tour({ kind: "open-bots", workspaceId });

    // Phase 6 — the workflow the bot admits. The daemon's own status is the
    // fact; a bot session that exits without admitting anything is a fact
    // too, and then the panel admits the graph itself and says so.
    setPhase("workflow", "running", "waiting for the bot's session to admit the Work Graph");
    let releasedBy: "bot" | "panel" = "bot";
    let releaseNote = `the bot's session ${dispatch.sessionId.slice(0, 8)} admitted it`;
    const started = await until(
      async () => {
        const status = await bridge.graphOrchestratorStatus({ workspaceId });
        if (status.ok && status.result.run?.id) return status.result.run;
        if (!bridge.sessionList) return null;
        const listed = await bridge.sessionList({ workspaceId });
        const session = listed.ok
          ? listed.result.sessions.find((entry) => entry.id === dispatch.sessionId)
          : null;
        if (!session || session.verdict !== "exited") return null;
        // The dispatcher is gone and admitted nothing: no one is left to race
        // — unless the viewer stopped following, in which case nothing more
        // is started on their behalf.
        ensureFollowing();
        const admitted = await bridge.graphOrchestratorStart({
          workspaceId,
          main: mainNodeFor(runtime, REPRO_SCENARIO_SPEC, workspaceId),
        });
        if (!admitted.ok) {
          // Most likely the bot got there between the two reads; the next
          // poll reads that run. Anything else is reported by the deadline.
          setPhase("workflow", "running", `waiting: ${admitted.error.message}`);
          return null;
        }
        releasedBy = "panel";
        releaseNote = `the bot's session ${dispatch.sessionId.slice(0, 8)} exited (code ${session.exitCode ?? "unknown"}) without admitting the workflow, so this panel admitted it`;
        return admitted.result.run;
      },
      "the bot never admitted the workflow",
      WORKFLOW_START_TIMEOUT_MS,
    );
    update({ workflowId: started.id, releasedBy, releaseNote });
    setPhase("workflow", "done", `workflow ${started.id.slice(0, 8)} · ${releasedBy === "bot" ? "admitted by the bot" : "admitted by this panel"}`);
    // The main session and its workers now appear under the run's project in
    // the sidebar. Keep the surface the viewer chose instead of replacing the
    // Bot session they may be reading.

    // Phase 7 — the rounds. The daemon's own status is what settles them.
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

    // Phase 8 — collect telemetry and cost without navigating away from the
    // session the viewer opened. The explicit "Show the telemetry" control
    // remains available when they want it.
    setPhase("evidence", "running");
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
    update({ running: false, spotlight: "evidence" });
  } catch (error) {
    if (generation !== runGeneration) return;
    const message = error instanceof Error ? error.message : String(error);
    mutate((previous) => {
      const phases = { ...previous.phases };
      for (const phase of REPRO_PHASES) {
        if (phases[phase.id].status === "running")
          phases[phase.id] = { status: "failed", note: message };
      }
      return { ...previous, phases, running: false, failure: message };
    });
    // The panel may be unmounted by the tour; make failures visible there.
    if (!cancelled) tour({ kind: "open-demo" });
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
