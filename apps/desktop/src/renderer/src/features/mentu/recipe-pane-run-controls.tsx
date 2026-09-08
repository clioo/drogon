// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// `src/renderer/src/components/mentu/recipe-pane-run-controls.tsx`: the
// Review → Approve & run two-phase gating with the reference's DOM,
// Tailwind classes, copy, icons and ARIA. Adapted only in the data layer:
// the reference reviews session execution intents through `check`/`doctor`
// RPCs this repo's daemon does not expose, so review here stages the
// loaded recipe (name, content hash, steps, runner) and the second phase
// approves that exact hash (`mentu.approve`) before executing
// (`mentu.run`). Cancel targets the running run; Retry resumes the failed
// run's recorded Mentu run id (`mentu.retry`), re-running only the steps
// that did not succeed against the recipe file as currently saved.

import { Play, RefreshCw, X } from "lucide-react";
import type { MentuApproval, MentuRun } from "../../../../shared/mentu-contract";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import type { MentuReview } from "./recipe-pane-controller";
import { statusLabel } from "./run-status";

function ReviewScope({
  review,
  owner,
  approval,
}: {
  review: MentuReview;
  owner: string;
  approval: MentuApproval | null;
}): React.JSX.Element {
  return (
    <div
      className="@container/mentu-review min-w-0 space-y-3 rounded-lg border border-border bg-card p-3 [overflow-wrap:anywhere]"
      data-testid="mentu-review"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">Review before execution</p>
        <Badge variant="secondary">{approval ? "Approved" : "Ready"}</Badge>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-2 text-xs @md/mentu-review:grid-cols-2 [&>p]:min-w-0">
        <p>
          <span className="text-muted-foreground">Recipe:</span> {review.recipeName}
        </p>
        <p>
          <span className="text-muted-foreground">Intent:</span> run
        </p>
        <p>
          <span className="text-muted-foreground">Plan:</span> sha256:{review.contentHash.slice(0, 12)}
          …
        </p>
        <p>
          <span className="text-muted-foreground">Inputs:</span> {review.stepCount} recipe step
          {review.stepCount === 1 ? "" : "s"}
        </p>
        <p>
          <span className="text-muted-foreground">Runner:</span> {review.runner}
        </p>
        <p>
          <span className="text-muted-foreground">Owner:</span> {owner}
        </p>
      </div>
      <div className="space-y-1 text-xs">
        <p className="font-medium">Effective harness routing</p>
        {review.steps.map((step) => (
          <p key={step.label} className="text-muted-foreground">
            {step.label}: {step.backend}
          </p>
        ))}
      </div>
    </div>
  );
}

export function RunControls({
  review,
  owner,
  runtimeAvailable,
  dependencyGraphValid,
  operationRunning,
  busy,
  run,
  approval,
  onStageReview,
  onApproveAndRun,
  onRetry,
  onCancel,
  onClearReview,
}: {
  review: MentuReview | null;
  owner: string;
  runtimeAvailable: boolean;
  dependencyGraphValid: boolean;
  operationRunning: boolean;
  busy: boolean;
  run: MentuRun | null;
  approval: MentuApproval | null;
  onStageReview: () => void;
  onApproveAndRun: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onClearReview: () => void;
}): React.JSX.Element {
  const disabled = !runtimeAvailable || !dependencyGraphValid || busy;
  const reviewed = review !== null;
  return (
    <div className="space-y-3">
      {review ? <ReviewScope review={review} owner={owner} approval={approval} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={reviewed ? "secondary" : "default"}
          disabled={disabled}
          onClick={() => (reviewed ? onApproveAndRun() : onStageReview())}
          data-testid="mentu-run"
        >
          <Play /> {reviewed ? "Approve & run" : "Review Run"}
        </Button>
        {run && (run.status === "failed" || run.status === "unavailable") && !operationRunning ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onRetry()}
            data-testid="mentu-retry"
          >
            <RefreshCw /> Retry
          </Button>
        ) : null}
        {operationRunning ? (
          <Button size="sm" variant="outline" onClick={() => onCancel()} data-testid="mentu-cancel">
            <X /> Cancel
          </Button>
        ) : null}
        {review ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={operationRunning}
            onClick={() => onClearReview()}
          >
            Dismiss review
          </Button>
        ) : null}
      </div>
      {run ? (
        <p
          className="text-xs text-muted-foreground"
          role={run.status === "failed" || run.status === "unavailable" ? "alert" : "status"}
          data-testid="mentu-run-status"
        >
          Latest run {run.mentuRunId ?? run.id}: {statusLabel(run.status)}
        </p>
      ) : null}
      {!dependencyGraphValid ? (
        <p className="text-xs text-muted-foreground">
          Run blocked until dependency cycles and references are resolved.
        </p>
      ) : null}
      {!runtimeAvailable ? (
        <p className="text-xs text-muted-foreground">
          Mentu is unavailable on this execution host.
        </p>
      ) : null}
    </div>
  );
}
