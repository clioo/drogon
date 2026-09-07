// Mentu (journey J9): the workspace's `.mentu/recipes`, an explicit
// approval bound to the exact recipe content, execution through the pinned
// `mentu-recipes` runtime, the run record with per-step evidence, and
// retry. Ported in spirit from the read-only reference's
// `src/renderer/src/components/mentu/MentuPanel.tsx` (copy, structure,
// keyboard/ARIA where portable) adapted to this repo's plain-Tailwind
// panel convention (see `AutomationsPanel.tsx`) rather than the reference's
// shadcn Select/Tabs, which this repo does not have. `variant="panel"`
// renders the compact right-panel surface; `variant="tab"` renders the
// wider tab from "+" — both read/write the same `useMentuState`.
//
// MIT Copyright (c) 2026 Lovecast Inc.

import { useEffect, useState } from "react";
import type {
  MentuApproval,
  MentuBridge,
  MentuRecipeDetail,
  MentuRecipeSummary,
  MentuRun,
} from "../../../../shared/mentu-contract";
import { Button } from "../../components/ui/button";
import { useMentuState } from "./mentu-store";

export type MentuPanelProps = {
  bridge: MentuBridge;
  workspaceId: string;
  variant?: "panel" | "tab";
};

const POLL_INTERVAL_MS = 750;

function statusLabel(status: MentuRun["status"] | undefined): string {
  switch (status) {
    case "running":
      return "Running…";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "unavailable":
      return "Unavailable";
    default:
      return "";
  }
}

function statusToneClass(status: MentuRun["status"] | undefined): string {
  switch (status) {
    case "succeeded":
      return "text-emerald-600 dark:text-emerald-400";
    case "failed":
    case "unavailable":
      return "text-destructive";
    case "cancelled":
      return "text-muted-foreground";
    default:
      return "text-foreground";
  }
}

export function MentuPanel({
  bridge,
  workspaceId,
  variant = "panel",
}: MentuPanelProps) {
  const [state, setState] = useMentuState(workspaceId);
  const [recipes, setRecipes] = useState<MentuRecipeSummary[]>([]);
  const [loadingRecipes, setLoadingRecipes] = useState(true);
  const [recipe, setRecipe] = useState<MentuRecipeDetail | null>(null);
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [approval, setApproval] = useState<MentuApproval | null>(null);
  const [run, setRun] = useState<MentuRun | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingRecipes(true);
    void bridge.mentuRecipes({ workspaceId }).then((result) => {
      if (cancelled) return;
      setLoadingRecipes(false);
      if (result.ok) setRecipes(result.result.recipes);
      else setError(result.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    setApproval(null);
    setRun(null);
    if (!state.selectedRecipeId) {
      setRecipe(null);
      return;
    }
    setLoadingRecipe(true);
    void bridge
      .mentuRecipe({ workspaceId, recipeId: state.selectedRecipeId })
      .then((result) => {
        if (cancelled) return;
        setLoadingRecipe(false);
        if (result.ok) {
          setRecipe(result.result.recipe);
          setState({ draftSource: result.result.recipe.source });
        } else {
          setRecipe(null);
          setError(result.error.message);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setState is stable per workspace
  }, [bridge, workspaceId, state.selectedRecipeId]);

  useEffect(() => {
    if (!run || run.status !== "running") return;
    let cancelled = false;
    const timer = setInterval(() => {
      void bridge.mentuRunStatus({ runId: run.id }).then((result) => {
        if (cancelled || result.ok === false) return;
        setRun(result.result.run);
      });
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [bridge, run]);

  const selectRecipe = (recipeId: string) => {
    setError("");
    setState({ selectedRecipeId: recipeId || null });
  };

  const approve = async () => {
    if (!recipe || !state.selectedRecipeId) return;
    setBusy(true);
    setError("");
    const result = await bridge.mentuApprove({
      workspaceId,
      recipeId: state.selectedRecipeId,
      contentHash: recipe.contentHash,
    });
    setBusy(false);
    if (result.ok) setApproval(result.result.approval);
    else setError(result.error.message);
  };

  const runRecipe = async () => {
    if (!approval || !state.selectedRecipeId) return;
    setBusy(true);
    setError("");
    const result = await bridge.mentuRun({
      workspaceId,
      recipeId: state.selectedRecipeId,
      approvalId: approval.id,
    });
    setBusy(false);
    if (result.ok) {
      setRun(result.result.run);
      setState({ activeRunId: result.result.run.id });
    } else setError(result.error.message);
  };

  const retry = async () => {
    if (!run) return;
    setBusy(true);
    setError("");
    const result = await bridge.mentuRetry({ runId: run.id });
    setBusy(false);
    if (result.ok) {
      setRun(result.result.run);
      setState({ activeRunId: result.result.run.id });
    } else setError(result.error.message);
  };

  const cancelRun = async () => {
    if (!run) return;
    setBusy(true);
    const result = await bridge.mentuCancel({ runId: run.id });
    setBusy(false);
    if (result.ok) setRun(result.result.run);
  };

  const validEntries = recipes.filter((entry) => entry.valid);
  const wide = variant === "tab";

  return (
    <div
      className={
        wide
          ? "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 text-foreground"
          : "flex min-h-0 flex-col gap-3 overflow-y-auto text-foreground"
      }
      data-testid={wide ? "mentu-tab" : "mentu-panel"}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">Mentu</h2>
          <p className="text-xs text-muted-foreground">
            Workspace source: .mentu/recipes
          </p>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="sr-only">Recipe</span>
        <select
          aria-label="Recipe"
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          value={state.selectedRecipeId ?? ""}
          disabled={loadingRecipes || validEntries.length === 0}
          onChange={(event) => selectRecipe(event.target.value)}
        >
          <option value="">
            {loadingRecipes ? "Discovering recipes…" : "Select a recipe"}
          </option>
          {validEntries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name ?? entry.id}
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loadingRecipe ? (
        <p className="text-sm text-muted-foreground">Loading recipe…</p>
      ) : recipe ? (
        <div className="flex flex-col gap-3">
          <div
            className="rounded-md border border-border bg-background p-3"
            data-testid="mentu-steps"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Steps
            </p>
            <ol className="mt-2 flex flex-col gap-1 text-sm">
              {recipe.steps.map((step) => {
                const stepRun = run?.steps.find((s) => s.label === step.label);
                return (
                  <li
                    key={step.label}
                    className="flex items-center justify-between gap-2 border-t border-border py-1 first:border-t-0"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{step.label}</span>
                      <span className="ml-2 text-muted-foreground">
                        {step.backend}
                      </span>
                    </span>
                    {stepRun ? (
                      <span
                        className={`shrink-0 text-xs ${statusToneClass(stepRun.status)}`}
                      >
                        {statusLabel(stepRun.status)}
                        {stepRun.exitCode !== null
                          ? ` · exit ${stepRun.exitCode}`
                          : ""}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>

          <details className="rounded-md border border-border bg-background p-3">
            <summary className="cursor-pointer text-xs font-medium">
              Source JSON
            </summary>
            <textarea
              aria-label="Mentu source JSON"
              readOnly
              value={state.draftSource}
              className="mt-2 min-h-32 w-full resize-y rounded-md border border-input bg-background p-2 font-mono text-[11px]"
            />
          </details>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy || approval !== null}
              onClick={() => void approve()}
              data-testid="mentu-approve"
            >
              {approval ? "Approved" : "Approve"}
            </Button>
            <Button
              size="sm"
              disabled={busy || !approval || (run !== null && run.status === "running")}
              onClick={() => void runRecipe()}
              data-testid="mentu-run"
            >
              Run
            </Button>
            {run && run.status === "running" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void cancelRun()}
                data-testid="mentu-cancel"
              >
                Cancel
              </Button>
            ) : null}
            {run &&
            (run.status === "failed" || run.status === "unavailable") ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void retry()}
                data-testid="mentu-retry"
              >
                Retry
              </Button>
            ) : null}
          </div>

          {run ? (
            <div
              className="rounded-md border border-border bg-background p-3 text-sm"
              role={
                run.status === "failed" || run.status === "unavailable"
                  ? "alert"
                  : "status"
              }
              data-testid="mentu-run-status"
            >
              <p className={`font-medium ${statusToneClass(run.status)}`}>
                {statusLabel(run.status)}
              </p>
              <p className="text-xs text-muted-foreground">
                Run {run.mentuRunId ?? run.id}
              </p>
              {run.error ? (
                <p className="mt-1 whitespace-pre-wrap text-xs text-destructive">
                  {run.error}
                </p>
              ) : null}
              {run.steps.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1 text-xs">
                  {run.steps.map((step) => (
                    <li key={step.label} className="flex flex-col gap-0.5">
                      <span>
                        <span className="font-medium">{step.label}</span>
                        <span
                          className={`ml-2 ${statusToneClass(step.status)}`}
                        >
                          {statusLabel(step.status)}
                        </span>
                      </span>
                      {step.outputPath ? (
                        <span className="font-mono text-muted-foreground">
                          stdout: {step.outputPath}
                        </span>
                      ) : null}
                      {step.errorPath ? (
                        <span className="font-mono text-muted-foreground">
                          stderr: {step.errorPath}
                        </span>
                      ) : null}
                      {step.error ? (
                        <span className="text-destructive">{step.error}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Select a valid recipe to inspect its steps.
        </p>
      )}

      <p className="w-fit shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
        Review required before host execution
      </p>
    </div>
  );
}
