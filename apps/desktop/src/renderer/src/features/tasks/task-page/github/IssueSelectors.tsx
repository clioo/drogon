// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/github/IssueSelectors.tsx — the
// label and assignee pickers for the issue-creation dialog. This repo has
// no issue-creation dialog yet; the pickers ship as pure props-driven
// components (tests cover the render contract) so the future dialog can
// adopt them verbatim.
import { useMemo, useCallback, type JSX } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "../../ui/popover";
import { Button } from "../../../../components/ui/button";
import { LoaderCircle, Check } from "lucide-react";
import { cn } from "../../cn";
import type { TaskPageWorkItem } from "../../task-page-model";
import { GitHubAssigneeAvatar } from "./Avatars";

type Assignee = TaskPageWorkItem["assignees"][number];

export function GitHubIssueLabelSelector({
  labels,
  selectedLabels,
  loading,
  error,
  disabled,
  onChange,
}: {
  labels: string[];
  selectedLabels: string[];
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onChange: (labels: string[]) => void;
}): JSX.Element {
  const selectedSet = useMemo(() => new Set(selectedLabels), [selectedLabels]);
  const toggleLabel = useCallback(
    (label: string) => {
      onChange(
        selectedSet.has(label)
          ? selectedLabels.filter((name) => name !== label)
          : [...selectedLabels, label],
      );
    },
    [onChange, selectedLabels, selectedSet],
  );
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label className="text-[11px] font-medium text-muted-foreground">Labels</label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="h-auto min-h-9 justify-start gap-2 px-3 py-2 text-left"
          >
            {selectedLabels.length === 0 ? (
              <span className="text-muted-foreground">None</span>
            ) : (
              <span className="flex min-w-0 flex-wrap gap-1.5">
                {selectedLabels.map((label) => (
                  <span
                    key={label}
                    className="rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[11px] font-medium"
                  >
                    {label}
                  </span>
                ))}
              </span>
            )}
            {loading ? <LoaderCircle className="ml-auto size-3.5 animate-spin" /> : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="popover-scroll-content scrollbar-sleek w-64 p-1" align="start">
          {error ? (
            <div className="px-2 py-2 text-xs text-destructive">{error}</div>
          ) : labels.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">No labels.</div>
          ) : (
            labels.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleLabel(label)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                <span
                  className={cn(
                    "flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                    selectedSet.has(label)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input",
                  )}
                >
                  {selectedSet.has(label) ? <Check className="size-2.5" /> : null}
                </span>
                <span className="min-w-0 truncate">{label}</span>
              </button>
            ))
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function GitHubIssueAssigneeSelector({
  assignees,
  selectedAssignees,
  loading,
  error,
  disabled,
  onChange,
}: {
  assignees: Assignee[];
  selectedAssignees: Assignee[];
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onChange: (assignees: Assignee[]) => void;
}): JSX.Element {
  const selectedLogins = useMemo(
    () => new Set(selectedAssignees.map((assignee) => assignee.login.toLowerCase())),
    [selectedAssignees],
  );
  const toggleAssignee = useCallback(
    (assignee: Assignee) => {
      const key = assignee.login.toLowerCase();
      onChange(
        selectedLogins.has(key)
          ? selectedAssignees.filter((current) => current.login.toLowerCase() !== key)
          : [...selectedAssignees, assignee],
      );
    },
    [onChange, selectedAssignees, selectedLogins],
  );
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label className="text-[11px] font-medium text-muted-foreground">Assignees</label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="h-auto min-h-9 justify-start gap-2 px-3 py-2 text-left"
          >
            {selectedAssignees.length === 0 ? (
              <span className="text-muted-foreground">Unassigned</span>
            ) : (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="flex -space-x-1">
                  {selectedAssignees.slice(0, 3).map((assignee) => (
                    <GitHubAssigneeAvatar key={assignee.login} assignee={assignee} />
                  ))}
                </span>
                <span className="min-w-0 truncate text-xs">
                  {selectedAssignees.map((assignee) => assignee.login).join(", ")}
                </span>
              </span>
            )}
            {loading ? <LoaderCircle className="ml-auto size-3.5 animate-spin" /> : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="popover-scroll-content scrollbar-sleek w-72 p-1" align="start">
          {error ? (
            <div className="px-2 py-2 text-xs text-destructive">{error}</div>
          ) : assignees.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">No assignable users.</div>
          ) : (
            assignees.map((assignee) => {
              const selected = selectedLogins.has(assignee.login.toLowerCase());
              return (
                <button
                  key={assignee.login}
                  type="button"
                  onClick={() => toggleAssignee(assignee)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
                >
                  <span
                    className={cn(
                      "flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input",
                    )}
                  >
                    {selected ? <Check className="size-2.5" /> : null}
                  </span>
                  <GitHubAssigneeAvatar assignee={assignee} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{assignee.login}</span>
                    {assignee.name ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {assignee.name}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
