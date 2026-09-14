// Settings → Demo: runs the whole reproducible chain from inside the app and
// walks the viewer through it, moving the focus to whatever is changing right
// now. Built for a screen recording: one control to start, then every step
// shows what the daemon reported, and nothing on screen is a placeholder.
//
// The chain: a project, a bot under Chats on the harness the viewer picked,
// the task sent to that bot's own session, the Work Graph the bot admits —
// its main session fanning out to parallel workers — the daemon's adversarial
// rounds, and the telemetry and cost at the end.

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleDashed, CircleDot, Play, XCircle } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { SettingsRow, SettingsSubsectionHeader } from "../SettingsFormControls";
import { SettingsSection } from "../SettingsSection";
import { useHarnessCatalog } from "../../agent-runtime/harness-catalog";
import { useModelCatalog } from "../../agent-runtime/model-catalog";
import { catalogModelOptions } from "../../agent-runtime/ModelPicker";
import {
  HarnessSelect,
  RuntimeModelField,
} from "../../work-graph-workflows/SubagentPolicyPanel";
import {
  DEFAULT_REPRO_ITERATIONS,
  REPRO_ITERATION_CHOICES,
  REPRO_PHASES,
  REPRO_SUPPORTED_HARNESSES,
  describeReproCost,
  describeWorkflowStatus,
  formatReproCost,
  harnessNeedsModel,
  pickDemoModel,
  type ReproPhaseId,
  type ReproPhaseState,
} from "./repro-demo-plan";
import { requestReproTour } from "../../../repro-demo-tour";
import { useReproDemo, type ReproDemoBridge } from "./use-repro-demo";
import {
  canRemoveDemoRuns,
  removeDemoRuns,
  type ReproCleanupReport,
} from "./repro-demo-store";

/** The bridges the demo needs, gathered from the frozen `window.drogon`
 *  namespaces. A build whose preload predates any of them reports the demo as
 *  unavailable instead of failing when someone presses the button. */
export function windowReproBridge(): ReproDemoBridge | null {
  try {
    const drogon = (window as unknown as { drogon?: Record<string, unknown> }).drogon;
    if (!drogon) return null;
    const graph = drogon.graph as Record<string, unknown> | undefined;
    const project = drogon.project as Record<string, unknown> | undefined;
    const needed = {
      status: drogon.status,
      projectCreate: project?.projectCreate,
      fileWrite: drogon.fileWrite,
      botCreate: drogon.botCreate,
      botRun: drogon.botRun,
      graphWritePolicy: graph?.graphWritePolicy,
      graphOrchestratorStart: graph?.graphOrchestratorStart,
      graphOrchestratorStatus: graph?.graphOrchestratorStatus,
      graphObservabilityStatus: graph?.graphObservabilityStatus,
    };
    if (Object.values(needed).some((value) => typeof value !== "function")) return null;
    // Housekeeping channels: present in this build or not, the demo runs.
    const optional = {
      botSnapshot: drogon.botSnapshot,
      botDelete: drogon.botDelete,
      projectList: project?.projectList,
      projectRemove: project?.projectRemove,
    };
    const housekeeping =
      Object.values(optional).every((value) => typeof value === "function")
        ? {
            botSnapshot: (input: unknown) =>
              (optional.botSnapshot as (value: unknown) => Promise<never>)(input),
            botDelete: (input: unknown) =>
              (optional.botDelete as (value: unknown) => Promise<never>)(input),
            projectList: () => (optional.projectList as () => Promise<never>)(),
            projectRemove: (input: unknown) =>
              (optional.projectRemove as (value: unknown) => Promise<never>)(input),
          }
        : {};
    // The workspace's session list: what lets the demo notice a bot session
    // that exited without admitting the workflow. Absent, it simply waits.
    const sessions =
      typeof drogon.sessions === "function"
        ? {
            sessionList: (input: { workspaceId: string }) =>
              (drogon.sessions as (value: string) => Promise<never>)(input.workspaceId),
          }
        : {};
    return {
      ...housekeeping,
      ...sessions,
      status: () => (needed.status as () => Promise<never>)(),
      projectCreate: (input) =>
        (needed.projectCreate as (value: unknown) => Promise<never>)(input),
      fileWrite: (input) => (needed.fileWrite as (value: unknown) => Promise<never>)(input),
      botCreate: (input) => (needed.botCreate as (value: unknown) => Promise<never>)(input),
      botRun: (input) => (needed.botRun as (value: unknown) => Promise<never>)(input),
      graphWritePolicy: (input) =>
        (needed.graphWritePolicy as (value: unknown) => Promise<never>)(input),
      graphOrchestratorStart: (input) =>
        (needed.graphOrchestratorStart as (value: unknown) => Promise<never>)(input),
      graphOrchestratorStatus: (input) =>
        (needed.graphOrchestratorStatus as (value: unknown) => Promise<never>)(input),
      graphObservabilityStatus: (input) =>
        (needed.graphObservabilityStatus as (value: unknown) => Promise<never>)(input),
    } as ReproDemoBridge;
  } catch {
    return null;
  }
}

function PhaseIcon({ status }: { status: ReproPhaseState["status"] }): React.JSX.Element {
  if (status === "done")
    return <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />;
  if (status === "failed") return <XCircle className="size-4 text-destructive" aria-hidden />;
  if (status === "running")
    return <CircleDot className="size-4 animate-pulse text-primary" aria-hidden />;
  return <CircleDashed className="size-4 text-muted-foreground" aria-hidden />;
}

/** Scrolls its child into view whenever it becomes the focused widget, so a
 *  viewer's eye follows the run without anyone touching the mouse. Respects
 *  the OS reduced-motion preference. */
function Spotlight({
  active,
  children,
  testId,
}: {
  active: boolean;
  children: React.ReactNode;
  testId: string;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    // `scrollIntoView` is absent in some embedders (jsdom included): the ring
    // is the focus signal, and scrolling is the enhancement.
    if (!active || !element || typeof element.scrollIntoView !== "function") return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "nearest",
    });
  }, [active]);
  return (
    <div
      ref={ref}
      data-testid={testId}
      data-spotlight={active ? "on" : "off"}
      className={[
        "rounded-lg transition-shadow",
        active ? "ring-2 ring-primary/70 ring-offset-2 ring-offset-background" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

/** A round's own verdict, in the product's badge grammar plus the semantic
 *  colour the Agent telemetry tab already uses: pass is green, findings
 *  amber, and anything else stays neutral rather than being dressed as
 *  either. */
function VerdictBadge({
  verdict,
  status,
}: {
  verdict: string | null;
  status: string;
}): React.JSX.Element {
  const tone =
    verdict === "pass"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : verdict === "findings"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "border-border/50 bg-background/50 text-foreground/80";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${tone}`}
    >
      {verdict ?? status}
    </span>
  );
}

/** One runtime of the run, chosen the way the Subagent policy chooses one:
 *  the harnesses installed here, and each harness's own model list. The demo
 *  proposes a model as soon as the list arrives — the host's recommended one
 *  when it names one — and the viewer's own pick wins over the proposal.
 *  With `follow`, the runtime mirrors another one until the viewer touches
 *  it: "the subagents run where the main agent runs" needs no explaining. */
export function useDemoRuntime(input: {
  initial: { harness: string; model: string } | null;
  defaultHarnessId: string | null;
  follow?: { harness: string; model: string } | null;
}) {
  const harnessCatalog = useHarnessCatalog();
  const installed = useMemo(
    () =>
      harnessCatalog.harnesses.filter((harness) =>
        (REPRO_SUPPORTED_HARNESSES as readonly string[]).includes(harness.harnessId),
      ),
    [harnessCatalog.harnesses],
  );
  const usable = useMemo(() => {
    const available = installed.filter((harness) => harness.availability === "available");
    return available.length > 0 ? available : installed;
  }, [installed]);
  const [harness, setHarness] = useState(input.initial?.harness ?? "");
  const [model, setModel] = useState(input.initial?.model ?? "");
  const [modelChosen, setModelChosen] = useState(Boolean(input.initial?.model));
  const [touched, setTouched] = useState(input.initial !== null);
  const following = Boolean(input.follow) && !touched;
  const followHarness = input.follow?.harness ?? null;
  const followModel = input.follow?.model ?? null;

  // Mirroring another runtime, exactly, until the viewer takes this one over.
  useEffect(() => {
    if (!following || followHarness === null || followModel === null) return;
    setHarness(followHarness);
    setModel(followModel);
    setModelChosen(true);
  }, [following, followHarness, followModel]);

  // The harness: the product's default when it is installed here, else the
  // first installed one — chosen once the catalog answers, never before, so a
  // harness that is not on this machine is never proposed.
  const { defaultHarnessId } = input;
  useEffect(() => {
    if (following || usable.length === 0) return;
    if (harness && usable.some((entry) => entry.harnessId === harness)) return;
    const pick =
      usable.find((entry) => entry.harnessId === defaultHarnessId) ?? usable[0];
    setHarness(pick.harnessId);
    setModel("");
    setModelChosen(false);
  }, [following, usable, defaultHarnessId, harness]);

  const modelCatalog = useModelCatalog(harness);
  const options = useMemo(
    () =>
      harness ? catalogModelOptions(modelCatalog.catalog) : [],
    [modelCatalog.catalog, harness],
  );
  useEffect(() => {
    if (following || modelChosen) return;
    const proposal = pickDemoModel(options);
    if (proposal && proposal !== model) setModel(proposal);
  }, [following, options, modelChosen, model]);

  const label = usable.find((entry) => entry.harnessId === harness)?.displayName ?? harness;
  return {
    harness,
    model,
    label,
    usable,
    catalogLoading: harnessCatalog.loading,
    modelProposed: Boolean(model) && !modelChosen,
    modelsListed: options.some((option) => option.id.trim().length > 0),
    following,
    chooseHarness: (next: string) => {
      setTouched(true);
      setHarness(next);
      // An id from another harness is never carried over silently.
      setModel("");
      setModelChosen(false);
    },
    chooseModel: (next: string) => {
      setTouched(true);
      setModel(next);
      setModelChosen(true);
    },
  };
}

/** The two rows one runtime takes in the section: its harness, and its model
 *  through the product's own picker. */
function RuntimeRows({
  runtime,
  who,
  disabled,
  testIdPrefix,
  harnessNote,
}: {
  runtime: ReturnType<typeof useDemoRuntime>;
  who: string;
  disabled: boolean;
  testIdPrefix: string;
  harnessNote: string;
}): React.JSX.Element {
  const modelNote = !runtime.harness
    ? "The list comes from the harness itself."
    : runtime.following
      ? `Same as the main agent. Pick a harness or a model here to change where ${who} run.`
      : runtime.model
        ? runtime.modelProposed
          ? `Proposed from what ${runtime.label} lists on this machine. Pick another from Models if you prefer.`
          : "Your pick."
        : harnessNeedsModel(runtime.harness)
          ? runtime.modelsListed
            ? `${runtime.label} needs an exact model id: pick one from Models.`
            : `${runtime.label} lists no models on this machine yet: pick one from Models, or type the exact id there.`
          : `${runtime.label} runs the model it is already set up with.`;
  return (
    <>
      <SettingsRow
        label="Harness"
        description={harnessNote}
        control={
          <div className="flex w-full max-w-md items-center gap-2">
            <HarnessSelect
              value={runtime.harness}
              harnesses={runtime.usable}
              disabled={disabled || runtime.usable.length === 0}
              onChange={runtime.chooseHarness}
              testId={`${testIdPrefix}-harness`}
            />
          </div>
        }
      />
      <SettingsRow
        label="Model"
        description={modelNote}
        control={
          <div className="flex w-full max-w-md items-center">
            <RuntimeModelField
              harness={runtime.harness}
              model={runtime.model}
              disabled={disabled || !runtime.harness}
              onChange={runtime.chooseModel}
              testIdPrefix={testIdPrefix}
            />
          </div>
        }
      />
    </>
  );
}

/** Why a runtime cannot run yet, or null when it can. */
function runtimeBlocker(runtime: ReturnType<typeof useDemoRuntime>, who: string): string | null {
  if (runtime.usable.length === 0)
    return runtime.catalogLoading
      ? "Reading the harnesses installed here…"
      : "No supported harness is installed here: install Claude Code, Codex, OpenCode or Pi first.";
  if (!runtime.harness) return `Choose a harness for ${who}.`;
  if (harnessNeedsModel(runtime.harness) && !runtime.model)
    return `${runtime.label} needs an exact model id for ${who}: pick one from Models.`;
  return null;
}

export function ReproDemoSection({
  bridge,
  defaultHarnessId = null,
}: {
  bridge?: ReproDemoBridge | null;
  /** The harness the product defaults to for new agents; the demo starts
   *  there when it is installed. */
  defaultHarnessId?: string | null;
}): React.JSX.Element {
  const resolved = useMemo(
    () => (bridge === undefined ? windowReproBridge() : bridge),
    [bridge],
  );
  const { state, run, cancel } = useReproDemo(resolved);
  // Reopening the panel after the tour must show what RAN, not the defaults:
  // the store remembers the selection across the unmount the tour causes.
  const runtime = useDemoRuntime({
    initial: state.selection
      ? { harness: state.selection.harness, model: state.selection.model }
      : null,
    defaultHarnessId,
  });
  const subagents = useDemoRuntime({
    initial: state.selection?.subagents ?? null,
    defaultHarnessId,
    follow: { harness: runtime.harness, model: runtime.model },
  });
  const [iterations, setIterations] = useState<number>(
    state.selection?.iterations ?? DEFAULT_REPRO_ITERATIONS,
  );
  const spotlightFor = (id: ReproPhaseId) => state.spotlight === id;
  const [cleaning, setCleaning] = useState(false);
  const [cleanup, setCleanup] = useState<ReproCleanupReport | null>(null);
  const cleanUp = () => {
    setCleaning(true);
    setCleanup(null);
    void removeDemoRuns(resolved)
      .then(setCleanup)
      .finally(() => setCleaning(false));
  };

  const blocked = !resolved
    ? "This build does not expose every channel the demo needs."
    : (runtimeBlocker(runtime, "the main agent") ?? runtimeBlocker(subagents, "the subagents"));

  return (
    <SettingsSection
      id="demo"
      title="Reproducible demo"
      description="Run the whole chain with one click: a project of its own, a bot under Chats that gets the task on the harness you picked, the Work Graph it admits — its main session fanning out to parallel workers — the adversarial rounds, and the telemetry and cost of what ran. It takes you along — Bots once the bot is at work, the run's sessions while they work, and the Work Graph's Agent telemetry at the end."
    >
      <div className="space-y-6">
        <SettingsSubsectionHeader
          title="Main agent"
          description="The bot's harness — its own session gets the prompt — and the runtime of the Work Graph's main session. Harnesses installed here and each one's own model list — the same choice the Subagent policy offers. The demo proposes a model; change it if you like."
        />
        <RuntimeRows
          runtime={runtime}
          who="the main agent"
          disabled={state.running}
          testIdPrefix="repro-demo"
          harnessNote={
            runtime.usable.length === 0 && !runtime.catalogLoading
              ? "No supported harness was found on this machine."
              : "Only harnesses installed on this machine are listed."
          }
        />

        <SettingsSubsectionHeader
          title="Subagents"
          description="Where the workers the main agent dispatches, and the daemon's test and review agents, run. Same as the main agent unless you say otherwise — a Claude Code main agent can delegate to Pi workers, for example."
        />
        <RuntimeRows
          runtime={subagents}
          who="the subagents"
          disabled={state.running}
          testIdPrefix="repro-demo-subagents"
          harnessNote="The Work Graph policy approves this runtime for every subagent."
        />

        <SettingsRow
          label="Round cap"
          description="How many times it may break and fix before stopping. The cap is a time valve, not a spend one."
          control={
            <div className="flex gap-2">
              {REPRO_ITERATION_CHOICES.map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={iterations === value ? "default" : "outline"}
                  disabled={state.running}
                  onClick={() => setIterations(value)}
                >
                  {value}
                </Button>
              ))}
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            data-testid="repro-demo-run"
            disabled={state.running || blocked !== null}
            onClick={() =>
              void run({
                runtime: { harness: runtime.harness, model: runtime.model },
                subagents: { harness: subagents.harness, model: subagents.model },
                iterations,
              })
            }
          >
            <Play className="mr-2 size-4" aria-hidden />
            {state.running ? "Running…" : "Run demo"}
          </Button>
          {state.running ? (
            <Button type="button" variant="outline" size="sm" onClick={cancel}>
              Stop following
            </Button>
          ) : null}
          {blocked && !state.running ? (
            <span className="text-sm text-muted-foreground" data-testid="repro-demo-blocked">
              {blocked}
            </span>
          ) : null}
          {state.workspaceId && state.workflowId ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="repro-demo-show-orchestration"
                onClick={() => {
                  if (!state.workspaceId) return;
                  requestReproTour({ kind: "open-sessions", workspaceId: state.workspaceId });
                }}
              >
                Show the sessions
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="repro-demo-show-telemetry"
                onClick={() => {
                  if (!state.workspaceId) return;
                  requestReproTour({ kind: "open-work-graph", workspaceId: state.workspaceId });
                  requestReproTour({ kind: "focus-view", view: "evidence" });
                }}
              >
                Show the telemetry
              </Button>
            </>
          ) : null}
          {state.projectName ? (
            <span
              data-testid="repro-demo-run-name"
              className="rounded-md border border-border/60 px-2 py-1 font-mono text-xs"
              title={state.workspaceId ?? undefined}
            >
              {state.projectName}
            </span>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          The demo leaves Settings on its own: the Bots page once the bot has
          its prompt, then this run's sessions once the bot admits the Work
          Graph — the main session and the workers it dispatches, side by
          side — and finally the Work Graph's Agent telemetry and Usage tabs.
          Come back to Settings whenever you like: the panel keeps the run.
        </p>

        <Spotlight active={state.spotlight !== null && state.running} testId="repro-demo-phases">
          <ol className="space-y-1" data-testid="repro-demo-phase-list">
            {REPRO_PHASES.map((phase) => {
              const item = state.phases[phase.id];
              return (
                <li
                  key={phase.id}
                  data-testid={`repro-demo-phase-${phase.id}`}
                  data-status={item.status}
                  className={[
                    "flex items-start gap-3 rounded-md px-3 py-2",
                    spotlightFor(phase.id) ? "bg-primary/5" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <PhaseIcon status={item.status} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{phase.title}</span>
                      {item.note ? (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {item.note}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{phase.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Spotlight>

        {state.dispatch ? (
          <Spotlight active={spotlightFor("prompt") || spotlightFor("workflow")} testId="repro-demo-dispatch">
            <div className="space-y-2">
              <SettingsSubsectionHeader
                title="The bot's session"
                description="The prompt went to a session of the bot's own, in this run's project. The daemon's receipt names it; the Bots page and Chats show it."
              />
              <p className="font-mono text-xs text-muted-foreground">
                session {state.dispatch.sessionId}
                {state.workflowId ? ` · workflow ${state.workflowId}` : ""}
              </p>
            </div>
          </Spotlight>
        ) : null}

        {state.rounds.length > 0 ? (
          <Spotlight active={spotlightFor("rounds")} testId="repro-demo-rounds">
            <div className="space-y-2">
              <SettingsSubsectionHeader
                title="Rounds"
                description={describeWorkflowStatus(state.workflowStatus ?? undefined)}
              />
              <ul className="space-y-1">
                {state.rounds.map((round) => (
                  <li
                    key={round.iteration + round.phase + (round.runtime ?? "")}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      round {round.iteration}
                    </span>
                    <span className="w-16 text-sm">{round.phase}</span>
                    <VerdictBadge verdict={round.verdict} status={round.status} />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {round.runtime ?? "—"}
                      {round.isFallback ? " (fallback)" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Spotlight>
        ) : null}

        {state.evidence.length > 0 || state.cost ? (
          <Spotlight active={spotlightFor("evidence")} testId="repro-demo-evidence">
            <div className="space-y-4">
              <SettingsSubsectionHeader
                title="Agent telemetry and cost"
                description={`${state.evidence.length} entries the daemon and the agents recorded, in the same ledgers that live in .drogon/ and read without Drogon. The full detail is on the Work Graph's Agent telemetry tab.`}
              />
              <ul className="space-y-2">
                {state.evidence.map((entry) => (
                  <li key={entry.id} className="text-sm">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {entry.role ?? "—"}
                    </span>{" "}
                    {entry.summary}
                  </li>
                ))}
              </ul>
              {state.cost ? (
                <div
                  data-testid="repro-demo-cost"
                  className="rounded-lg border border-border/60 bg-background px-4 py-3"
                >
                  <div className="text-lg font-semibold tabular-nums">
                    {formatReproCost(state.cost)}
                  </div>
                  <p className="text-xs text-muted-foreground">{describeReproCost(state.cost)}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {state.cost.inputTokens ?? "—"} in · {state.cost.outputTokens ?? "—"} out
                  </p>
                </div>
              ) : null}
            </div>
          </Spotlight>
        ) : null}

        {state.releasedBy ? (
          <p className="text-xs text-muted-foreground" data-testid="repro-demo-release">
            Workflow admitted by{" "}
            {state.releasedBy === "bot"
              ? "the bot's own session"
              : "this panel (the bot's session exited without admitting it)"}
            {state.releaseNote ? ` · ${state.releaseNote}` : ""}
          </p>
        ) : null}

        {state.failure ? (
          <p className="text-sm text-destructive" data-testid="repro-demo-failure">
            {state.failure}
          </p>
        ) : null}

        {canRemoveDemoRuns(resolved) ? (
          <div className="space-y-2 border-t border-border pt-4">
            <SettingsSubsectionHeader
              title="Tidy up"
              description="Every run leaves its bot under Chats and its project under Projects, so they can be compared. Remove them all when you are done — only the demo's own bots and projects, nothing else."
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="repro-demo-cleanup"
                disabled={state.running || cleaning}
                onClick={cleanUp}
              >
                {cleaning ? "Removing…" : "Remove demo runs"}
              </Button>
              {cleanup ? (
                <span
                  className={`text-xs ${cleanup.errors.length > 0 ? "text-destructive" : "text-muted-foreground"}`}
                  data-testid="repro-demo-cleanup-result"
                >
                  Removed {cleanup.bots} bot{cleanup.bots === 1 ? "" : "s"} and {cleanup.projects}{" "}
                  project{cleanup.projects === 1 ? "" : "s"}
                  {cleanup.errors.length > 0 ? ` · ${cleanup.errors.join(" · ")}` : "."}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}
