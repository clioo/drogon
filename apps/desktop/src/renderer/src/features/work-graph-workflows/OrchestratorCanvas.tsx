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
// recipe step. Consequences: no session → the whole graph is honestly
// DISABLED (never an empty canvas that looks broken); a live session shows
// its REAL harness; the session record carries no `model` field today (see
// `shared/session-contract.ts`), so the model chip says so honestly
// instead of fabricating one — a real product gap, not something this
// view invents an answer for.
//
// "Run workflow" launches exactly the automated, non-interactive portion:
// when Adversarial testing is on, the (real) adversarial loop; when it is
// off, there is nothing automated configured yet, so the control is
// disabled with an honest reason — "Ready to run" means the main agent
// alone is enough, not "click to run something".

import { useState } from "react";
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

function MainAgentNode({
  mainSession,
}: {
  mainSession: Session | null;
}): React.JSX.Element {
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
  const live = isMentuMainSessionLive(mainSession);
  const exited = mainSession.verdict === "exited";
  return (
    <div
      className={`flex w-56 flex-col gap-1.5 rounded-lg border-2 p-3 ${
        live
          ? "border-purple-500 bg-purple-500/5 dark:bg-purple-500/10"
          : "border-dashed border-amber-500/60 bg-amber-500/5"
      }`}
      data-testid="orchestrator-main-agent"
      data-state={live ? "live" : exited ? "exited" : "unverifiable"}
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
            ? "This session has exited."
            : "Contact with this session was lost."}
        </p>
      ) : null}
    </div>
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
}): React.JSX.Element {
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const disabled = mainSession === null;

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
              <MainAgentNode mainSession={mainSession} />
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
                Repeat up to {policy.adversarial.maxIterations}×
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
