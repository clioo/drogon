// MIT Copyright (c) 2026 Lovecast Inc.
// The Orchestrator canvas (Part 2 / Part 4): a fixed, policy-driven layout
// — never the free-form authoring canvas's drag-and-drop positions — since
// its shape is entirely determined by the Subagent policy: Main agent →
// either "Ready to run" (no optional subagents) or the Adversarial loop
// (Adversarial test ⇄ Code review, up to N times) → "Ready to merge".
//
// Part 4, decided here: the Main agent node is NOT an authored graph node
// at all — it is a live projection of the workspace's real main session
// (`pickMentuMainSession`, the same primitive the Mentu dispatch seam
// uses), because the main agent IS that interactive session, not a batch
// recipe step. Consequences: no session EVER observed → the whole graph is
// honestly DISABLED (never an empty canvas that looks broken); a live
// session shows its REAL harness; the session record carries no `model`
// field today (see `shared/session-contract.ts`), so the model chip says
// so honestly instead of fabricating one — a real product gap, not
// something this view invents an answer for. The daemon's session list
// drops a session once it is fully torn down, so a session that already
// exited is remembered locally (`lastKnownRef`) rather than collapsing the
// canvas back to "no session" and losing that fact — see `MainAgentNode`'s
// `stale` handling. The node is clickable into a small inspector exposing
// the same leader-node rules an authored node's `NodeInspector` already
// enforces while live: harness-change refusal, and delete/stop refusal
// with a real Stop-session action — never a model-next-launch badge, since
// there is no model field to defer.
//
// "Run workflow" launches exactly the automated, non-interactive portion:
// when Adversarial testing is on, the (real) adversarial loop; when it is
// off, there is nothing automated configured yet, so the control is
// disabled with an honest reason — "Ready to run" means the main agent
// alone is enough, not "click to run something".

import { useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  Maximize,
  Play,
  Shield,
} from "lucide-react";
import type { GraphPolicy } from "../../../../shared/graph-contract";
import type { Session } from "../../../../shared/session-contract";
import { isMentuMainSessionLive } from "../mentu/mentu-run-dispatch";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import type { LoopLedger } from "./adversarial-loop";
import { isTerminalPhase } from "./adversarial-loop";

const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;
const ZOOM_DEFAULT = 100;

function Chip({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

/** The Main agent node (Part 4/Scenario 7): a live projection of the real
 *  session, clickable into a small inspector exposing the SAME three
 *  leader-node honesty rules `WorkGraphDesigner`'s `NodeInspector` already
 *  enforces for an authored node's live session — harness-change refusal,
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
              {guardReason}, so its harness cannot change. Start a new session with a different
              harness if you need one — the change would apply at the next launch, not now.
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Model</p>
          <p className="mt-1 text-sm text-muted-foreground">model not tracked</p>
        </div>
        <div className="border-t border-border pt-2">
          <p className="text-xs font-medium text-muted-foreground">Danger zone</p>
          {guardActive ? (
            <>
              <p
                className="mt-1 text-[11px] text-muted-foreground"
                data-testid="main-agent-delete-refused"
              >
                {guardReason}, so this is the workspace's main session and it cannot be deleted
                from here. Stop it first — that is the honest action, not a silent removal.
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
}: {
  title: string;
  caption: string;
  icon: React.ReactNode;
  tone: "test" | "review";
  active: boolean;
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
        <Chip>Subagent policy</Chip>
        <Chip>Auto failover</Chip>
      </div>
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
  onBack,
  workspaceId,
  onStopMainSession,
  stoppingMainSession,
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
  onBack?: () => void;
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
}): React.JSX.Element {
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  // The Main agent node is a live projection of the real session (Part 4),
  // but the daemon's session list drops a session once it is fully torn
  // down — `mainSession` itself goes back to null the moment a session
  // exits and the workspace is reloaded. Losing that fact would silently
  // regress the whole canvas to "never had a session" (the exact FINDING
  // this guards against): remember the last OBSERVED session so the node
  // can still say `exited`/`unverifiable` instead of vanishing. Reset the
  // memory the moment the workspace changes so a fact from workspace A can
  // never bleed into workspace B's honestly-never-had-one view.
  const lastKnownRef = useRef<{ workspaceId: string | undefined; session: Session } | null>(
    null,
  );
  if (mainSession) {
    lastKnownRef.current = { workspaceId, session: mainSession };
  } else if (lastKnownRef.current && lastKnownRef.current.workspaceId !== workspaceId) {
    lastKnownRef.current = null;
  }
  const lastKnownSession = mainSession ? null : (lastKnownRef.current?.session ?? null);
  // Once the fresh record is gone we no longer have live confirmation —
  // even a session that was `live` a moment ago must never be claimed live
  // now (`MainAgentNode` enforces this via `stale`); a session already
  // observed `exited` keeps saying so, since that specific fact stays true
  // forever.
  const stale = mainSession === null && lastKnownSession !== null;
  const displaySession = mainSession ?? lastKnownSession;
  const disabled = displaySession === null;
  const loopInFlight = loopLedger !== null && !isTerminalPhase(loopLedger.phase);
  const repeatBound = loopInFlight ? loopLedger.maxCycles : policy.adversarial.maxIterations;
  const repeatPending = loopInFlight && policy.adversarial.maxIterations !== loopLedger.maxCycles;

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col bg-background"
      data-testid="orchestrator-canvas"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
        {onBack ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={onBack}
            aria-label="Back to Work Graph"
            data-testid="orchestrator-back"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Button>
        ) : null}
        <h1 className="text-sm font-semibold">Orchestrator</h1>
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
                onSelect={() => setZoom(ZOOM_DEFAULT)}
                data-testid="orchestrator-fit-view-reset"
              >
                Fit view ({ZOOM_DEFAULT}%)
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  setZoom((current) => Math.min(ZOOM_MAX, current + ZOOM_STEP))
                }
                data-testid="orchestrator-zoom-in"
              >
                Zoom in
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  setZoom((current) => Math.max(ZOOM_MIN, current - ZOOM_STEP))
                }
                data-testid="orchestrator-zoom-out"
              >
                Zoom out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

      <div className="relative flex min-h-0 flex-1 items-center overflow-auto bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] bg-[length:16px_16px] p-8">
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
            className="mx-auto flex flex-col items-center gap-3"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: "center",
            }}
            data-testid="orchestrator-flow"
          >
            <div className="flex items-center gap-3">
              <MainAgentNode
                mainSession={displaySession}
                stale={stale}
                onStopMainSession={onStopMainSession}
                stoppingMainSession={stoppingMainSession}
              />
              <div className="h-px w-8 bg-border" aria-hidden />
              {policy.adversarial.enabled ? (
                <div className="relative flex items-center gap-3 rounded-lg border-2 border-dashed border-border p-3 pt-6">
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
                    active={
                      loopLedger?.phase === "reviewing" ||
                      loopLedger?.phase === "awaiting_base"
                    }
                  />
                  <div className="h-px w-6 bg-border" aria-hidden />
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
                    active={loopLedger?.phase === "fixing"}
                  />
                </div>
              ) : null}
              <div className="h-px w-8 bg-border" aria-hidden />
              <ReadyBadge
                label={
                  policy.adversarial.enabled ? "Ready to merge" : "Ready to run"
                }
                ledger={policy.adversarial.enabled ? loopLedger : null}
              />
            </div>
            {policy.adversarial.enabled ? (
              <p
                className="text-xs text-muted-foreground"
                data-testid="orchestrator-repeat-caption"
              >
                Repeat up to {repeatBound}×
                {repeatPending ? (
                  <span
                    className="ml-1 text-amber-600 dark:text-amber-400"
                    data-testid="orchestrator-repeat-pending"
                  >
                    — {policy.adversarial.maxIterations}× applies to the next run
                  </span>
                ) : null}
              </p>
            ) : (
              <p
                className="text-xs text-muted-foreground"
                data-testid="orchestrator-no-subagents-caption"
              >
                No optional subagents enabled
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
