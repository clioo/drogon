// MIT Copyright (c) 2026 Lovecast Inc.
// Policy preview and daemon-observed execution share the same fixed layout.

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  Maximize,
  Play,
  Shield,
  Users,
} from "lucide-react";
import type {
  GraphPolicy,
  GraphObservabilitySnapshot,
  OrchestratorRun,
} from "../../../../shared/graph-contract";
import type { Session } from "../../../../shared/session-contract";
import {
  isFreeDefaultRuntime,
  policyFirstRuntime,
} from "../../../../shared/work-graph-contract";
import { isMentuMainSessionLive } from "../mentu/mentu-run-dispatch";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { EvidenceView, UsageView } from "./ObservabilityViews";
import type { LoopLedger } from "./adversarial-loop";
import {
  loadLastKnownMainSession,
  saveLastKnownMainSession,
} from "./last-known-main-session";
import { isTerminalPhase } from "./adversarial-loop";

const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;
const ZOOM_DEFAULT = 100;
const EMPTY_OBSERVABILITY: GraphObservabilitySnapshot = {
  evidence: [],
  usage: [],
  updatedAt: "",
};

function WorkGraphViewTabs({
  activeView,
  onActiveViewChange,
  evidenceCount,
}: {
  activeView: "graph" | "evidence" | "usage";
  onActiveViewChange: (view: "graph" | "evidence" | "usage") => void;
  evidenceCount: number;
}): React.JSX.Element {
  return (
    <Tabs
      value={activeView}
      onValueChange={(value) =>
        onActiveViewChange(value as "graph" | "evidence" | "usage")
      }
    >
      <TabsList className="h-8" aria-label="Work Graph views">
        <TabsTrigger value="graph" className="h-7 text-xs">
          Graph
        </TabsTrigger>
        <TabsTrigger value="evidence" className="h-7 text-xs">
          Evidence
          {evidenceCount > 0 ? (
            <span className="ml-1 text-[10px] text-muted-foreground">
              {evidenceCount}
            </span>
          ) : null}
        </TabsTrigger>
        <TabsTrigger value="usage" className="h-7 text-xs">
          Usage
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function Chip({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

/** F0: BEFORE "Run workflow" launches anything that is not the free local
 *  default, the canvas must say which runtime will be spawned and that it
 *  is paid/external — never a silent spawn. Shows only when the adversarial
 *  loop is actually configured to run (nothing automated otherwise). */
function RuntimeDisclosure({
  policy,
}: {
  policy: GraphPolicy;
}): React.JSX.Element | null {
  if (!policy.adversarial.enabled) return null;
  const runtime = policyFirstRuntime(policy);
  const free = isFreeDefaultRuntime(runtime);
  return (
    <span
      className={`text-[11px] ${free ? "text-muted-foreground" : "font-medium text-amber-700 dark:text-amber-400"}`}
      data-testid="orchestrator-runtime-disclosure"
      data-free-default={free}
    >
      {free
        ? `Runs on the free local model (${runtime.model}) — never billed.`
        : `Will run on ${runtime.harness}/${runtime.model} — a paid/external runtime, not the free local default.`}
    </span>
  );
}

/** The Main agent node (Part 4/Scenario 7): a live projection of the real
 *  session, clickable into a small inspector exposing the SAME three
 *  leader-node honesty rules for a live session — harness-change refusal,
 *  and delete/stop refusal-with-a-real-stop-action. There is deliberately
 *  no model-applies-next-launch row: `Session` carries no `model` field
 *  today (see the top-of-file comment), so inventing a next-launch badge
 *  for a field that does not exist would be its own dishonesty; "model not
 *  tracked" stays the honest, unchanged readout.
 *
 *  The guard for all of this is `!exited`, not the coarser `live` alone:
 *  an `unverifiable` session (contact lost, not confirmed exited — AGENTS.md
 *  is explicit that loss of contact never proves exit) could otherwise be
 *  treated as safely stoppable while a real process might still be
 *  running. Only a CONFIRMED exit lifts the guard. */
function MainAgentNode({
  mainSession,
  stale,
  onStopMainSession,
  stoppingMainSession,
}: {
  mainSession: Session | null;
  /** True when `mainSession` is the last OBSERVED record, not a fresh
   *  read (see `OrchestratorCanvas`'s `lastKnownRef`) — live can never be
   *  claimed for a stale record, only a status already known to be
   *  `exited` stays `exited`. */
  stale: boolean;
  onStopMainSession?: () => void;
  stoppingMainSession?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  if (!mainSession) {
    return (
      <div
        className="flex w-56 flex-col gap-1 rounded-lg border-2 border-dashed border-muted-foreground/40 bg-muted/20 p-3"
        data-testid="orchestrator-main-agent"
        data-state="no-session"
      >
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium text-muted-foreground">
            Main agent
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">No session yet.</p>
      </div>
    );
  }
  const live = !stale && isMentuMainSessionLive(mainSession);
  const exited = mainSession.verdict === "exited";
  const guardActive = !exited;
  const dataState = live ? "live" : exited ? "exited" : "unverifiable";
  const guardReason = live
    ? "This session is live"
    : "Contact with this session was lost, so it cannot be assumed dead";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex w-56 flex-col gap-1.5 rounded-lg border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
            live
              ? "border-purple-500 bg-purple-500/5 hover:bg-purple-500/10 dark:bg-purple-500/10"
              : "border-dashed border-amber-500/60 bg-amber-500/5 hover:bg-amber-500/10"
          }`}
          data-testid="orchestrator-main-agent"
          data-state={dataState}
          aria-label={`Main agent, ${dataState}. Open inspector.`}
        >
          <div className="flex items-center gap-2">
            <Bot
              className={`size-4 ${live ? "text-purple-600 dark:text-purple-400" : "text-amber-600 dark:text-amber-400"}`}
              aria-hidden
            />
            <span className="text-sm font-medium">Main agent</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Chip>{mainSession.harnessId ?? "shell"}</Chip>
            <Chip>model not tracked</Chip>
          </div>
          {!live ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              {exited
                ? "This session has exited. Start a new session to continue."
                : "Contact with this session was lost."}
            </p>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 space-y-3 text-xs"
        data-testid="main-agent-inspector"
      >
        <div>
          <p className="text-xs font-medium text-muted-foreground">Harness</p>
          <p className="mt-1 text-sm">{mainSession.harnessId ?? "shell"}</p>
          {guardActive ? (
            <p
              className="mt-1 text-[11px] text-muted-foreground"
              data-testid="main-agent-harness-locked"
            >
              {guardReason}, so its harness cannot change. Start a new session
              with a different harness if you need one — the change would apply
              at the next launch, not now.
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Model</p>
          <p className="mt-1 text-sm text-muted-foreground">
            model not tracked
          </p>
        </div>
        <div className="border-t border-border pt-2">
          <p className="text-xs font-medium text-muted-foreground">
            Danger zone
          </p>
          {guardActive ? (
            <>
              <p
                className="mt-1 text-[11px] text-muted-foreground"
                data-testid="main-agent-delete-refused"
              >
                {guardReason}, so this is the workspace's main session and it
                cannot be deleted from here. Stop it first — that is the honest
                action, not a silent removal.
              </p>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="mt-2"
                disabled={!onStopMainSession || stoppingMainSession}
                onClick={() => onStopMainSession?.()}
                data-testid="main-agent-stop-session"
              >
                {stoppingMainSession ? "Stopping…" : "Stop session"}
              </Button>
            </>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">
              This session has already exited — there is nothing to stop.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ReadyBadge({
  label,
  ledger,
}: {
  label: string;
  ledger: LoopLedger | null;
}): React.JSX.Element {
  if (!ledger) {
    return (
      <div
        className="flex w-44 items-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/40 bg-muted/20 p-3"
        data-testid="orchestrator-terminal"
        data-state="never-run"
      >
        <CheckCircle2 className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium text-muted-foreground">
          {label}
        </span>
      </div>
    );
  }
  const passed = ledger.phase === "passed";
  const terminal = isTerminalPhase(ledger.phase);
  const failedTerminal = terminal && !passed;
  return (
    <div
      className={`flex w-44 items-center gap-2 rounded-lg border-2 p-3 ${
        passed
          ? "border-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/10"
          : failedTerminal
            ? "border-destructive bg-destructive/5"
            : "border-dashed border-muted-foreground/40 bg-muted/20"
      }`}
      data-testid="orchestrator-terminal"
      data-state={passed ? "ready" : failedTerminal ? "failed" : "in-progress"}
    >
      {passed ? (
        <CheckCircle2
          className="size-4 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        />
      ) : failedTerminal ? (
        <Shield className="size-4 text-destructive" aria-hidden />
      ) : (
        <Loader2
          className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
          aria-hidden
        />
      )}
      <span className="text-sm font-medium">
        {passed ? label : ledger.message}
      </span>
    </div>
  );
}

function LoopRoleNode({
  title,
  caption,
  icon,
  tone,
  active,
  step,
}: {
  title: string;
  caption: string;
  icon: React.ReactNode;
  tone: "test" | "review";
  active: boolean;
  step?: OrchestratorRun["steps"][number];
}): React.JSX.Element {
  const toneClasses =
    tone === "test"
      ? "border-destructive bg-destructive/5"
      : "border-cyan-500 bg-cyan-500/5 dark:bg-cyan-500/10";
  return (
    <div
      className={`flex w-48 flex-col gap-1.5 rounded-lg border-2 p-3 ${toneClasses}`}
      data-testid={`orchestrator-${tone}-node`}
      data-active={active}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium">{title}</span>
        {active ? (
          <Loader2
            className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden
          />
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground">{caption}</p>
      <div className="flex flex-wrap gap-1.5">
        <Chip>{step?.runtime?.harness ?? "Subagent policy"}</Chip>
        <Chip>{step?.runtime?.model || "Auto failover"}</Chip>
      </div>
      {step ? (
        <p className="text-[11px] text-muted-foreground">
          Iteration {step.iteration} · {step.status}
          {step.isFallback ? " · Fallback" : ""}
          {step.verdict ? ` · ${step.verdict}` : ""}
        </p>
      ) : null}
      {step && step.attempts.length > 0 ? (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">
            {step.attempts.length} runtime attempts
          </summary>
          <ol className="mt-1 space-y-1">
            {step.attempts.map((attempt, index) => (
              <li key={index}>
                {index + 1}. {attempt.harness} / {attempt.model || "default"} ·{" "}
                {attempt.outcome}
                {attempt.reason ? ` — ${attempt.reason}` : ""}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

export function OrchestratorCanvas({
  policy,
  mainSession,
  loopLedger,
  onRunWorkflow,
  canRun,
  runDisabledReason,
  saveStatus,
  saveError,
  workspaceId,
  onStopMainSession,
  stoppingMainSession,
  configuredMain,
  durableRun,
  runError,
  onStopRun,
  onResumeRun,
  activeView = "graph",
  onActiveViewChange = () => {},
  observability = EMPTY_OBSERVABILITY,
  observabilityLoading = false,
  observabilityError = null,
}: {
  policy: GraphPolicy;
  mainSession: Session | null;
  loopLedger: LoopLedger | null;
  onRunWorkflow: () => void;
  canRun: boolean;
  runDisabledReason: string | null;
  saveStatus: "idle" | "saving" | "saved" | "error";
  saveError: string | null;
  /** Returns to the read-only Work Graph view. Optional so this component
   *  stays testable standalone. */
  /** Scopes the last-observed-session memory below to ONE workspace, so a
   *  session that exited in a DIFFERENT workspace can never bleed into one
   *  that has honestly never had a session at all. Optional so standalone
   *  tests need not pass it (a missing id just means every render is
   *  treated as the same workspace, which is correct for a component that
   *  never switches workspaces in its own lifetime). */
  workspaceId?: string;
  /** Real termination of the Main agent's session — the same `session.stop`
   *  every other Stop control in the app uses (App.tsx's
   *  `stopActiveBotSession`), threaded down so the leader-node danger zone
   *  below can refuse deletion honestly AND offer the one action that
   *  actually resolves it. Optional so a host that cannot mutate sessions
   *  renders the refusal without a broken button. */
  onStopMainSession?: () => void;
  stoppingMainSession?: boolean;
  configuredMain?: { harness: string; model: string; prompt: string };
  durableRun?: OrchestratorRun | null;
  runError?: string | null;
  onStopRun?: () => void;
  onResumeRun?: () => void;
  activeView?: "graph" | "evidence" | "usage";
  onActiveViewChange?: (view: "graph" | "evidence" | "usage") => void;
  observability?: GraphObservabilitySnapshot;
  observabilityLoading?: boolean;
  observabilityError?: string | null;
}): React.JSX.Element {
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const viewport = useRef<HTMLDivElement>(null);
  const flow = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(true);
  const [viewportWidth, setViewportWidth] = useState(0);
  const narrow = viewportWidth > 0 && viewportWidth < 900;
  const executionActive =
    durableRun?.status === "running" || durableRun?.status === "stopping";
  const previewPolicy = executionActive ? durableRun.policy : policy;
  const previewHasLoop = previewPolicy.adversarial.enabled;
  const previewDelegates =
    previewPolicy.delegate || previewPolicy.adversarial.enabled;
  useEffect(() => {
    if (!viewport.current) return;
    const resize = () => {
      const element = viewport.current;
      if (element) setViewportWidth(element.clientWidth);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(viewport.current);
    resize();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!fit || !viewport.current || !flow.current || !viewportWidth) return;
    const fitToViewport = () => {
      const content = flow.current;
      if (!content) return;
      setZoom(
        Math.max(
          30,
          Math.min(
            100,
            Math.floor(((viewportWidth - 48) / content.scrollWidth) * 100),
          ),
        ),
      );
    };
    const observer = new ResizeObserver(fitToViewport);
    observer.observe(flow.current);
    fitToViewport();
    return () => observer.disconnect();
  }, [
    fit,
    viewportWidth,
    narrow,
    previewHasLoop,
    previewDelegates,
    durableRun?.status,
    policy.adversarial.enabled,
    durableRun?.policy.adversarial.enabled,
  ]);
  // The Main agent node is a live projection of the real session (Part 4),
  // but the daemon's session list drops a session once it is fully torn
  // down — `mainSession` itself goes back to null the moment a session
  // exits, EVEN WHILE this canvas stays mounted (confirmed empirically: an
  // external `terminal close` never reaches this view without a reload,
  // and the reload itself then wipes any in-memory-only fix). Losing that
  // fact would silently regress the whole canvas to "never had a session"
  // (the exact FINDING this guards against): remember the last OBSERVED
  // session in-memory for the current mount AND in `localStorage` (see
  // `last-known-main-session.ts`) so the node can still say
  // `exited`/`unverifiable` across a real reload, not only within one
  // render tree's lifetime. Reset the memory the moment the workspace
  // changes so a fact from workspace A can never bleed into workspace B's
  // honestly-never-had-one view.
  const lastKnownRef = useRef<{
    workspaceId: string | undefined;
    session: Session;
  } | null>(null);
  if (mainSession) {
    lastKnownRef.current = { workspaceId, session: mainSession };
    if (workspaceId) saveLastKnownMainSession(workspaceId, mainSession);
  } else if (
    lastKnownRef.current &&
    lastKnownRef.current.workspaceId !== workspaceId
  ) {
    lastKnownRef.current = null;
  }
  if (lastKnownRef.current === null && mainSession === null && workspaceId) {
    const persisted = loadLastKnownMainSession(workspaceId);
    if (persisted) lastKnownRef.current = { workspaceId, session: persisted };
  }
  const lastKnownSession = mainSession
    ? null
    : (lastKnownRef.current?.session ?? null);
  // Once the fresh record is gone we no longer have live confirmation —
  // even a session that was `live` a moment ago must never be claimed live
  // now (`MainAgentNode` enforces this via `stale`); a session already
  // observed `exited` keeps saying so, since that specific fact stays true
  // forever.
  const stale = mainSession === null && lastKnownSession !== null;
  const displaySession = mainSession ?? lastKnownSession;
  const disabled = displaySession === null && !configuredMain;
  const loopInFlight =
    loopLedger !== null && !isTerminalPhase(loopLedger.phase);
  const repeatBound = loopInFlight
    ? loopLedger.maxCycles
    : policy.adversarial.maxIterations;
  const repeatPending =
    loopInFlight && policy.adversarial.maxIterations !== loopLedger.maxCycles;
  const running = executionActive;
  const showLoop = previewHasLoop;
  const effectiveMain = running ? durableRun.main : configuredMain;
  const latestStep = (phase: "test" | "review") =>
    durableRun?.steps.filter((step) => step.phase === phase).at(-1);

  if (activeView !== "graph") {
    return (
      <div
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
        data-testid="orchestrator-canvas"
      >
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
          <h1 className="text-sm font-semibold">Work Graph</h1>
          <WorkGraphViewTabs
            activeView={activeView}
            onActiveViewChange={onActiveViewChange}
            evidenceCount={observability.evidence.length}
          />
          <span className="text-xs text-muted-foreground">
            Native .drogon ledger
          </span>
        </div>
        {observabilityError ? (
          <p
            className="border-b border-border px-4 py-2 text-xs text-destructive"
            role="alert"
          >
            {observabilityError}
          </p>
        ) : null}
        {activeView === "evidence" ? (
          <EvidenceView
            snapshot={observability}
            loading={observabilityLoading}
          />
        ) : (
          <UsageView snapshot={observability} loading={observabilityLoading} />
        )}
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
      data-testid="orchestrator-canvas"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
        <h1 className="text-sm font-semibold">Work Graph</h1>
        <WorkGraphViewTabs
          activeView={activeView}
          onActiveViewChange={onActiveViewChange}
          evidenceCount={observability.evidence.length}
        />
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
          Workflow preview
        </span>
        <span
          className="flex items-center gap-1.5 text-xs"
          data-testid="orchestrator-save-status"
        >
          {saveStatus === "error" ? (
            <span className="text-destructive" role="status">
              Save failed{saveError ? `: ${saveError}` : ""}
            </span>
          ) : saveStatus === "saving" ? (
            <span className="text-muted-foreground" role="status">
              Saving…
            </span>
          ) : (
            <>
              <CheckCircle2
                className="size-3.5 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
              <span className="text-muted-foreground">Saved automatically</span>
            </>
          )}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="orchestrator-fit-view"
              >
                <Maximize className="size-3.5" aria-hidden />
                Fit view
                <ChevronDown className="size-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => setFit(true)}
                data-testid="orchestrator-fit-view-reset"
              >
                Fit view
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => (
                  setFit(false),
                  setZoom((current) => Math.min(ZOOM_MAX, current + ZOOM_STEP))
                )}
                data-testid="orchestrator-zoom-in"
              >
                Zoom in
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => (
                  setFit(false),
                  setZoom((current) => Math.max(ZOOM_MIN, current - ZOOM_STEP))
                )}
                data-testid="orchestrator-zoom-out"
              >
                Zoom out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <RuntimeDisclosure policy={policy} />
          {running ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onStopRun}
              disabled={durableRun.status === "stopping"}
            >
              Stop
            </Button>
          ) : null}
          {durableRun?.status === "stopped" ? (
            <Button size="sm" variant="outline" onClick={onResumeRun}>
              Resume run
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={!canRun}
            title={runDisabledReason ?? undefined}
            onClick={onRunWorkflow}
            data-testid="orchestrator-run-workflow"
          >
            <Play className="size-3.5" aria-hidden />
            Run workflow
          </Button>
        </div>
      </div>
      {runError ? (
        <p className="px-4 py-2 text-xs text-destructive" role="alert">
          {runError}
        </p>
      ) : null}
      {running ? (
        <p className="px-4 py-2 text-xs text-muted-foreground">
          Run {durableRun.id} · {durableRun.phase} · Iteration{" "}
          {durableRun.iteration}. Configuration changes apply to the next run.
        </p>
      ) : null}
      <div
        ref={viewport}
        className="relative flex min-h-80 flex-1 items-center overflow-auto bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] bg-[length:16px_16px] p-6"
      >
        {disabled ? (
          <div
            className="mx-auto flex max-w-md flex-col items-center gap-3 text-center"
            data-testid="orchestrator-disabled"
          >
            <Bot className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">
              Start a session to enable the orchestrator
            </p>
            <p className="text-xs text-muted-foreground">
              The main node is always bound to this workspace's main session —
              the graph stays honestly disabled until one exists.
            </p>
          </div>
        ) : (
          <div
            ref={flow}
            className="mx-auto flex w-max shrink-0 flex-col items-center gap-3"
            style={{
              zoom: zoom / 100,
            }}
            data-testid="orchestrator-flow"
          >
            <div
              className={`flex items-center gap-3 ${narrow ? "flex-col" : "flex-row"}`}
              data-testid="orchestrator-flow-sequence"
              data-direction={narrow ? "vertical" : "horizontal"}
            >
              {effectiveMain ? (
                <div
                  className="flex w-56 flex-col gap-2 rounded-lg border-2 border-purple-500 bg-purple-500/5 p-3"
                  data-testid="orchestrator-main-agent"
                >
                  <span className="text-sm font-medium">Main agent</span>
                  <div className="flex flex-wrap gap-1">
                    <Chip>{effectiveMain.harness}</Chip>
                    <Chip>{effectiveMain.model || "Harness default"}</Chip>
                    {previewDelegates ? <Chip>Director</Chip> : null}
                  </div>
                  <p className="line-clamp-3 text-xs text-muted-foreground">
                    {effectiveMain.prompt || "Configure the main task"}
                  </p>
                </div>
              ) : (
                <MainAgentNode
                  mainSession={displaySession}
                  stale={stale}
                  onStopMainSession={onStopMainSession}
                  stoppingMainSession={stoppingMainSession}
                />
              )}
              {previewDelegates ? (
                <>
                  <ArrowRight
                    className={`size-6 shrink-0 text-muted-foreground ${narrow ? "rotate-90" : ""}`}
                    aria-hidden
                  />
                  <div
                    className="flex w-48 flex-col gap-1.5 rounded-lg border border-border bg-card p-3"
                    data-testid="orchestrator-depth-one-workers"
                  >
                    <div className="flex items-center gap-2">
                      <Users
                        className="size-4 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="text-sm font-medium">
                        Implementation workers
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Chip>Depth 1</Chip>
                      <Chip>Subagent policy</Chip>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Planned and supervised by the main agent
                    </p>
                  </div>
                </>
              ) : null}
              <ArrowRight
                className={`size-6 shrink-0 text-muted-foreground ${narrow ? "rotate-90" : ""}`}
                aria-hidden
              />
              {showLoop ? (
                <div className="relative flex items-center gap-3 rounded-lg border-2 border-dashed border-border p-3 pb-9 pt-6">
                  <span className="absolute -top-3 left-3 flex items-center gap-1.5 bg-background px-1 text-xs font-medium">
                    Adversarial loop
                    <Badge variant="outline" className="text-[10px]">
                      Depth 1
                    </Badge>
                  </span>
                  <LoopRoleNode
                    title="Adversarial test"
                    caption="Find edge cases and failure"
                    icon={
                      <Shield className="size-4 text-destructive" aria-hidden />
                    }
                    tone="test"
                    step={latestStep("test")}
                    active={
                      (running && durableRun.phase === "test") ||
                      loopLedger?.phase === "reviewing" ||
                      loopLedger?.phase === "awaiting_base"
                    }
                  />
                  <ArrowRight
                    className="size-6 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <LoopRoleNode
                    title="Code review"
                    caption="Review changes and verify fixes"
                    icon={
                      <FileText
                        className="size-4 text-cyan-600 dark:text-cyan-400"
                        aria-hidden
                      />
                    }
                    tone="review"
                    step={latestStep("review")}
                    active={
                      (running && durableRun.phase === "review") ||
                      loopLedger?.phase === "fixing"
                    }
                  />
                  <svg
                    className="absolute bottom-1 left-10 h-7 w-[calc(100%-5rem)] text-muted-foreground"
                    viewBox="0 0 360 28"
                    preserveAspectRatio="none"
                    aria-label="Return to adversarial testing when findings remain"
                  >
                    <path
                      d="M350 0 V14 Q350 22 342 22 H18 Q10 22 10 14 V4 M5 9 L10 4 L15 9"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                  </svg>
                </div>
              ) : null}
              {showLoop ? (
                <ArrowRight
                  className={`size-6 shrink-0 text-muted-foreground ${narrow ? "rotate-90" : ""}`}
                  aria-hidden
                />
              ) : null}
              {durableRun ? (
                <div
                  className="w-40 rounded-lg border border-border p-3 text-sm"
                  data-testid="orchestrator-terminal"
                >
                  {!running ? "Last run: " : ""}
                  {durableRun.status === "passed"
                    ? durableRun.policy.adversarial.enabled
                      ? "Ready to merge"
                      : "Completed"
                    : durableRun.status}
                  {durableRun.error ? (
                    <p className="mt-1 text-xs text-destructive">
                      {durableRun.error}
                    </p>
                  ) : null}
                </div>
              ) : (
                <ReadyBadge
                  label={
                    showLoop
                      ? loopLedger?.phase === "passed"
                        ? "Ready to merge"
                        : "Awaiting checks"
                      : "Ready to run"
                  }
                  ledger={policy.adversarial.enabled ? loopLedger : null}
                />
              )}
            </div>
            {showLoop ? (
              <p
                className="text-xs text-muted-foreground"
                data-testid="orchestrator-repeat-caption"
              >
                Repeat up to{" "}
                {running
                  ? durableRun.policy.adversarial.maxIterations
                  : repeatBound}
                ×
                {repeatPending ? (
                  <span
                    className="ml-1 text-amber-600 dark:text-amber-400"
                    data-testid="orchestrator-repeat-pending"
                  >
                    — {policy.adversarial.maxIterations}× applies to the next
                    run
                  </span>
                ) : null}
              </p>
            ) : (
              <p
                className="text-xs text-muted-foreground"
                data-testid="orchestrator-no-subagents-caption"
              >
                {previewDelegates
                  ? "Delegate mode · depth-1 implementation workers"
                  : "Direct mode · main agent works without subagents"}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
