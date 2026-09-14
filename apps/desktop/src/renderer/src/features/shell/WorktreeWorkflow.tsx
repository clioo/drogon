import { useEffect, useId, useRef, useState } from "react";
import { ChevronRight, GitFork } from "lucide-react";
import type {
  GraphBridge,
  OrchestratorRun,
} from "../../../../shared/graph-contract";
import { useOrchestratorRun } from "../work-graph-workflows/use-orchestrator-run";

const phases = {
  main: "Main agent",
  test: "Adversarial test",
  review: "Code review",
};
const statuses: Record<OrchestratorRun["status"], string> = {
  running: "Running",
  stopping: "Stopping",
  passed: "Passed",
  exhausted: "Iteration limit reached",
  failed: "Failed",
  stopped: "Stopped",
  unverifiable: "Unverifiable",
};

/** Keep the durable workflow visible beside the native session rows it launches. */
export function WorktreeWorkflow({
  workspaceId,
  bridge,
}: {
  workspaceId: string;
  bridge: GraphBridge | null;
}) {
  const { run, error } = useOrchestratorRun(bridge, workspaceId, 3000, 10_000);
  const labelId = useId();
  const [expanded, setExpanded] = useState(false);
  const autoExpandedRunId = useRef<string | null>(null);
  const active =
    run !== null &&
    ["running", "stopping", "unverifiable"].includes(run.status);
  useEffect(() => {
    // Open each newly observed active workflow once so its Main agent and
    // chosen harness are visible immediately beside its native sessions.
    // After that, a user's collapse wins across polling updates.
    if (!run || !active || autoExpandedRunId.current === run.id) return;
    autoExpandedRunId.current = run.id;
    setExpanded(true);
  }, [active, run]);
  if (!run || run.workspaceId !== workspaceId) return null;
  const status = error ? "Unverifiable" : statuses[run.status];
  const usesNativeSessions = run.steps.some((step) =>
    step.runId?.startsWith("session:"),
  );
  return (
    <div className="shell-worktree-card-rows min-w-0 text-xs">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={labelId}
        onClick={() => setExpanded(!expanded)}
        className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-1 text-left text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronRight
          size={12}
          className={expanded ? "shrink-0 rotate-90" : "shrink-0"}
          aria-hidden="true"
        />
        <GitFork size={12} className="shrink-0" aria-hidden="true" />
        <span className="truncate">Work Graph · {status}</span>
      </button>
      <div
        id={labelId}
        className={
          expanded ? "flex min-w-0 flex-col gap-1 px-2 py-1" : "hidden"
        }
      >
        <p className="break-words text-foreground">{run.main.title}</p>
        <p className="text-muted-foreground">
          {usesNativeSessions
            ? "Native workspace sessions"
            : "Legacy background workflow · no terminal"}
        </p>
        {run.steps.map((step) => (
          <div key={step.nodeId} className="min-w-0">
            <p className="text-foreground">
              {phases[step.phase]} ·{" "}
              {error && ["running", "dispatching"].includes(step.status)
                ? "unverifiable"
                : step.status}
              {step.phase !== "main" ? ` · ${step.iteration}` : ""}
            </p>
            {step.runtime && (
              <p className="break-all text-muted-foreground">
                {step.runtime.harness} ·{" "}
                {step.runtime.provider ? `${step.runtime.provider}/` : ""}
                {step.runtime.model}
                {step.isFallback ? " · Fallback" : ""}
              </p>
            )}
            {step.attempts
              .filter((attempt) => attempt.reason)
              .map((attempt, index) => (
                <p key={index} className="break-words text-muted-foreground">
                  {attempt.harness} · {attempt.outcome}: {attempt.reason}
                </p>
              ))}
          </div>
        ))}
        {(error || run.error) && (
          <p role="status" className="break-words text-destructive">
            {error || run.error}
          </p>
        )}
        <p className="break-all text-muted-foreground">Run {run.id}</p>
      </div>
    </div>
  );
}
