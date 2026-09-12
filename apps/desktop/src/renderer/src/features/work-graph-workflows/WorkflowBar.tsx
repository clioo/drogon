// MIT Copyright (c) 2026 Lovecast Inc.
// The workflow bar, drawn directly on the Work Graph canvas per the
// owner's ask: pick which of several named, saved workflows is active
// (with the selection always visible, never ambiguous), configure the
// bounded adversarial-review loop for it (on/off, max cycles), and show
// exactly where an in-progress or finished loop stands. No drag-and-drop —
// this is a compact settings surface, not a second canvas.

import { useState } from "react";
import { GitBranch, Loader2, Plus, Settings2, Trash2 } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  MAX_REVIEW_CYCLES,
  MIN_REVIEW_CYCLES,
  type WorkflowEntry,
  type WorkflowLibrary,
  type WorkflowSettings,
} from "./workflow-library";
import type { WorkflowMutationResult } from "./use-workflow-library";
import { ADVERSARIAL_MODEL, isTerminalPhase, type LoopLedger } from "./adversarial-loop";
import { policyMayRunPaidRuntime, type GraphPolicy } from "../../../../shared/work-graph-contract";

function loopToneClass(phase: LoopLedger["phase"]): string {
  switch (phase) {
    case "passed":
      return "text-emerald-600 dark:text-emerald-400 border-emerald-600/40 dark:border-emerald-400/40";
    case "stopped_failing":
    case "fix_failed":
    case "launch_refused":
      return "text-destructive border-destructive/40";
    case "unverifiable":
    case "blocked":
      return "text-amber-600 dark:text-amber-400 border-amber-600/40 dark:border-amber-400/40";
    default:
      return "text-muted-foreground border-border";
  }
}

function LoopStatus({ loop }: { loop: LoopLedger }): React.JSX.Element {
  const inFlight = !isTerminalPhase(loop.phase);
  return (
    <div
      className={`flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${loopToneClass(loop.phase)}`}
      role="status"
      data-testid="workflow-loop-status"
      data-workflow-loop-phase={loop.phase}
    >
      {inFlight ? (
        <Loader2 className="size-3 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : null}
      <span className="min-w-0 break-words">{loop.message}</span>
    </div>
  );
}

function NewWorkflowControl({
  onCreate,
  disabled,
}: {
  onCreate: (name: string) => Promise<WorkflowMutationResult>;
  disabled: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setName("");
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          data-testid="workflow-bar-new"
        >
          <Plus className="size-3.5" aria-hidden />
          New workflow
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <Label htmlFor="workflow-bar-new-name" className="text-xs text-muted-foreground">
          Name — saved from the graph currently on the canvas
        </Label>
        <Input
          id="workflow-bar-new-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 h-8 text-xs"
          placeholder="e.g. Ship feature"
          data-testid="workflow-bar-new-name"
          autoFocus
        />
        {error ? (
          <p className="mt-1 text-[11px] text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <Button
          type="button"
          size="sm"
          className="mt-2 w-full"
          disabled={busy || name.trim().length === 0}
          data-testid="workflow-bar-new-confirm"
          onClick={async () => {
            setBusy(true);
            setError(null);
            const result = await onCreate(name.trim());
            setBusy(false);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            setOpen(false);
            setName("");
          }}
        >
          Create
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function ManageWorkflowControl({
  workflow,
  onRename,
  onDelete,
  canDelete,
}: {
  workflow: WorkflowEntry;
  onRename: (id: string, name: string) => Promise<WorkflowMutationResult>;
  onDelete: (id: string) => Promise<WorkflowMutationResult>;
  canDelete: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(workflow.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setName(workflow.name);
        setError(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Manage this workflow"
          data-testid="workflow-bar-manage"
        >
          <Settings2 className="size-3.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <Label htmlFor="workflow-bar-rename-name" className="text-xs text-muted-foreground">
          Rename
        </Label>
        <div className="mt-1 flex gap-1.5">
          <Input
            id="workflow-bar-rename-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-8 text-xs"
            data-testid="workflow-bar-rename-name"
          />
          <Button
            type="button"
            size="sm"
            disabled={busy || name.trim().length === 0}
            data-testid="workflow-bar-rename-confirm"
            onClick={async () => {
              setBusy(true);
              const result = await onRename(workflow.id, name.trim());
              setBusy(false);
              if (!result.ok) setError(result.message);
            }}
          >
            Save
          </Button>
        </div>
        {error ? (
          <p className="mt-1 text-[11px] text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="mt-3 w-full"
          disabled={busy || !canDelete}
          title={canDelete ? undefined : "The last workflow cannot be deleted."}
          data-testid="workflow-bar-delete"
          onClick={async () => {
            setBusy(true);
            const result = await onDelete(workflow.id);
            setBusy(false);
            if (result.ok) setOpen(false);
            else setError(result.message);
          }}
        >
          <Trash2 className="size-3.5" aria-hidden />
          Delete workflow
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function WorkflowBar({
  library,
  selected,
  loop,
  interactive,
  policy,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onSettingsChange,
}: {
  library: WorkflowLibrary | null;
  selected: WorkflowEntry | null;
  loop: LoopLedger | null;
  /** False without a graph/file bridge in this build: the bar still shows
   *  what it knows, but every control that would write is disabled with an
   *  honest reason instead of silently doing nothing. */
  interactive: boolean;
  /** F0: the workspace's Subagent policy — the ONLY thing that can make
   *  this checkbox's loop spawn a paid/external runtime instead of the
   *  free local default. The cost note below must reflect THIS, never a
   *  hardcoded "never billed" claim that stops being true the moment any
   *  approved/fallback runtime is configured elsewhere in the app. */
  policy: GraphPolicy;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<WorkflowMutationResult>;
  onRename: (id: string, name: string) => Promise<WorkflowMutationResult>;
  onDelete: (id: string) => Promise<WorkflowMutationResult>;
  onSettingsChange: (
    id: string,
    patch: Partial<WorkflowSettings>,
  ) => Promise<WorkflowMutationResult>;
}): React.JSX.Element {
  const workflows = library?.workflows ?? [];
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2"
      data-testid="workflow-bar"
    >
      <GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      {workflows.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <Select
            value={selected?.id ?? undefined}
            onValueChange={onSelect}
            disabled={!interactive}
          >
            <SelectTrigger
              size="sm"
              className="min-w-40"
              aria-label="Selected workflow"
              data-testid="workflow-bar-select"
            >
              <SelectValue placeholder="Select a workflow" />
            </SelectTrigger>
            <SelectContent>
              {workflows.map((workflow) => (
                <SelectItem key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge
            variant="outline"
            className="shrink-0 text-[10px]"
            data-testid="workflow-bar-selected-badge"
          >
            Selected
          </Badge>
          {selected ? (
            <ManageWorkflowControl
              workflow={selected}
              onRename={onRename}
              onDelete={onDelete}
              canDelete={workflows.length > 1}
            />
          ) : null}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground" data-testid="workflow-bar-empty">
          No workflows saved yet.
        </span>
      )}
      <NewWorkflowControl onCreate={onCreate} disabled={!interactive} />

      {selected ? (
        <div className="ml-2 flex min-w-0 flex-wrap items-center gap-3 border-l border-border pl-3">
          <div className="flex items-center gap-1.5">
            <Checkbox
              id="workflow-bar-adversarial"
              checked={selected.settings.adversarialReviewEnabled}
              disabled={!interactive}
              data-testid="workflow-bar-adversarial-checkbox"
              onCheckedChange={(checked) =>
                void onSettingsChange(selected.id, { adversarialReviewEnabled: checked === true })
              }
            />
            <Label htmlFor="workflow-bar-adversarial" className="text-xs">
              Send adversarial review when this workflow finishes
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Label htmlFor="workflow-bar-max-cycles" className="text-xs text-muted-foreground">
              Max cycles
            </Label>
            <Input
              id="workflow-bar-max-cycles"
              type="number"
              min={MIN_REVIEW_CYCLES}
              max={MAX_REVIEW_CYCLES}
              value={selected.settings.maxReviewCycles}
              disabled={!interactive || !selected.settings.adversarialReviewEnabled}
              className="h-7 w-16 text-xs"
              data-testid="workflow-bar-max-cycles"
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                const clamped = Math.min(MAX_REVIEW_CYCLES, Math.max(MIN_REVIEW_CYCLES, Math.round(value)));
                void onSettingsChange(selected.id, { maxReviewCycles: clamped });
              }}
            />
          </div>
          {selected.settings.adversarialReviewEnabled ? (
            policyMayRunPaidRuntime(policy) ? (
              <span
                className="text-[10px] font-medium text-amber-700 dark:text-amber-400"
                data-testid="workflow-bar-cost-note"
              >
                This workspace's Subagent policy allows a paid/external runtime for this loop — it
                is NOT free-local-only. Check the Orchestrator's Subagent policy panel for exactly
                which ones. The cap limits time, not spend.
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground" data-testid="workflow-bar-cost-note">
                Free local model only ({ADVERSARIAL_MODEL}) — never billed. The cap limits time, not
                spend.
              </span>
            )
          ) : null}
        </div>
      ) : null}

      {loop ? (
        <div className="basis-full">
          <LoopStatus loop={loop} />
        </div>
      ) : null}
    </div>
  );
}
