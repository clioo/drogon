/* MIT Copyright (c) 2026 Lovecast Inc.
   The Linear source surface: connect prompt when disconnected, otherwise
   the fixture-backed list with search, start (create worktree + durable
   link), link to an existing worktree, open and unlink. */
import { useMemo, useState } from "react";
import { LoaderCircle, Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { LinearIcon } from "../../../components/icons/LinearIcon";
import type { IssueDetails } from "../../../../../shared/worktree-issue-contract";
import type { TaskPageModelProps } from "../task-page-model";
import { TaskPageLinearConnectDialog } from "./linear-connect-dialog";
import {
  createLinearFixtureIssue,
  filterLinearIssues,
} from "./linear-connection";
import { getLinearIssueWorkspaceActions } from "./linear-issue-workspace-actions";

function stateTone(stateName: string | null): string {
  const name = (stateName ?? "").toLowerCase();
  if (name.includes("progress") || name.includes("review")) {
    return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-200";
  }
  if (name.includes("done") || name.includes("complete")) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200";
  }
  return "border-border/50 bg-muted/40 text-muted-foreground";
}

function LinearIssueRow({
  model,
  issue,
}: TaskPageModelProps & { issue: IssueDetails }): React.JSX.Element {
  const {
    linearLinks,
    linearWorktrees,
    linearBusyKey,
    handleStartLinearItem,
    handleLinkLinearItem,
    handleUnlinkLinearItem,
    onOpenLinearWorktree,
    openLinearIssueUrl,
    writeLinearClipboardText,
  } = model;
  const link = linearLinks.find(
    (entry) =>
      entry.provider === "linear" &&
      entry.identifier.toUpperCase() === issue.identifier.toUpperCase(),
  );
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkWorktreeId, setLinkWorktreeId] = useState("");
  const busyStart = linearBusyKey === `start:${issue.identifier}`;
  const busyLink = linearBusyKey === `link:${issue.identifier}`;
  const busyUnlink = linearBusyKey === `unlink:${issue.identifier}`;
  const busy = busyStart || busyLink || busyUnlink;
  const actions = useMemo(
    () =>
      getLinearIssueWorkspaceActions(issue, {
        openUrl: openLinearIssueUrl,
        writeClipboardText: writeLinearClipboardText,
      }),
    [issue, openLinearIssueUrl, writeLinearClipboardText],
  );

  return (
    <li
      className="flex flex-col gap-2 border-b border-border/40 px-3 py-2.5 last:border-b-0"
      data-linear-issue={issue.identifier}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          <LinearIcon className="size-3" />
          {issue.identifier}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {issue.title}
        </span>
        {issue.stateName ? (
          <span
            className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${stateTone(issue.stateName)}`}
          >
            {issue.stateName}
          </span>
        ) : null}
      </div>
      {issue.labels.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {issue.labels.map((label) => (
            <span
              key={label}
              className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {link ? (
          <>
            <Button
              size="xs"
              onClick={() => onOpenLinearWorktree(link.worktreeId)}
              aria-label={`Open workspace attached to ${issue.identifier}`}
            >
              Open
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => handleUnlinkLinearItem(issue)}
              aria-label={`Unlink ${issue.identifier}`}
            >
              {busyUnlink ? "Working…" : "Unlink"}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="xs"
              disabled={busy}
              onClick={() => handleStartLinearItem(issue)}
              aria-label={`Start workspace from ${issue.identifier}`}
            >
              {busyStart ? "Starting…" : "Start"}
            </Button>
            {linearWorktrees.length > 0 ? (
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setLinkPickerOpen((open) => !open);
                  setLinkWorktreeId((current) =>
                    current || linearWorktrees[0]?.id || "",
                  );
                }}
                aria-label={`Link ${issue.identifier} to a worktree`}
                aria-expanded={linkPickerOpen}
              >
                Link
              </Button>
            ) : null}
          </>
        )}
        {actions.map(({ label, icon: Icon, action }) => (
          <Button
            key={label}
            size="xs"
            variant="ghost"
            onClick={action}
            aria-label={`${label} ${issue.identifier}`}
            title={label}
          >
            <Icon className="size-3.5" />
          </Button>
        ))}
      </div>
      {linkPickerOpen && !link ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-2 py-1.5">
          <label
            className="text-[11px] font-medium text-muted-foreground"
            htmlFor={`linear-link-${issue.identifier}`}
          >
            Link to
          </label>
          <select
            id={`linear-link-${issue.identifier}`}
            className="h-7 min-w-0 flex-1 rounded-md border border-border/50 bg-background px-1.5 text-xs"
            value={linkWorktreeId}
            onChange={(event) => setLinkWorktreeId(event.target.value)}
          >
            {linearWorktrees.map((worktree) => (
              <option key={worktree.id} value={worktree.id}>
                {worktree.label}
              </option>
            ))}
          </select>
          <Button
            size="xs"
            disabled={busy || !linkWorktreeId}
            onClick={() => {
              if (linkWorktreeId) handleLinkLinearItem(issue, linkWorktreeId);
            }}
          >
            {busyLink ? "Linking…" : "Confirm"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setLinkPickerOpen(false)}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function TaskPageLinearContent({
  model,
}: TaskPageModelProps): React.JSX.Element | null {
  const {
    linearConnected,
    linearConnectOpen,
    setLinearConnectOpen,
    refreshLinearStatus,
    linearIssues,
    linearLoading,
    linearError,
    linearSearchInput,
    setLinearSearchInput,
    handleRefreshLinearIssues,
    hideTaskSource,
  } = model;
  const [newOpen, setNewOpen] = useState(false);
  const [newIdentifier, setNewIdentifier] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newError, setNewError] = useState<string | null>(null);

  const visible = useMemo(
    () => filterLinearIssues(linearIssues, linearSearchInput),
    [linearIssues, linearSearchInput],
  );

  if (!linearConnected) {
    return (
      <div className="mt-4 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
        <LinearIcon className="mb-4 size-8 text-muted-foreground/60" />
        <p className="text-base font-medium text-foreground">
          Connect Linear
        </p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Browse and start work from Linear issues directly from here. The
          key stays on this machine; issues come from the local fixture
          collection, never the network.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => setLinearConnectOpen(true)}>
            Connect Linear
          </Button>
          <Button variant="outline" onClick={() => hideTaskSource("linear", "Linear")}>
            Hide Linear
          </Button>
        </div>
        <TaskPageLinearConnectDialog
          open={linearConnectOpen}
          onOpenChange={setLinearConnectOpen}
          onConnected={refreshLinearStatus}
        />
      </div>
    );
  }

  const createIssue = () => {
    const created = createLinearFixtureIssue({
      identifier: newIdentifier,
      title: newTitle,
    });
    if (!created) {
      setNewError("Enter a key like ENG-123 and a title.");
      return;
    }
    setNewIdentifier("");
    setNewTitle("");
    setNewError(null);
    setNewOpen(false);
    handleRefreshLinearIssues();
  };

  return (
    <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-background shadow-sm">
      <div className="rounded-md rounded-b-none border-b border-border/50 bg-muted/50 px-3 pt-2 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={linearSearchInput}
              onChange={(event) => setLinearSearchInput(event.target.value)}
              placeholder="Filter Linear issues"
              aria-label="Filter Linear issues"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setNewOpen((open) => !open)}
            aria-expanded={newOpen}
          >
            <Plus className="size-3.5" />
            New
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={handleRefreshLinearIssues}
            aria-label="Refresh Linear issues"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        {newOpen ? (
          <div className="mt-2 flex flex-col gap-2 rounded-md border border-border/50 bg-background px-2 py-2">
            <div className="flex flex-wrap gap-2">
              <Input
                value={newIdentifier}
                onChange={(event) => setNewIdentifier(event.target.value)}
                placeholder="ENG-123"
                aria-label="New Linear issue key"
                className="h-8 w-32 text-xs"
              />
              <Input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") createIssue();
                }}
                placeholder="Issue title"
                aria-label="New Linear issue title"
                className="h-8 min-w-0 flex-1 text-xs"
              />
              <Button size="xs" onClick={createIssue}>
                Create
              </Button>
            </div>
            {newError ? (
              <p role="alert" className="text-xs text-destructive">
                {newError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {linearLoading ? (
        <div className="flex items-center justify-center py-14">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : linearError ? (
        <div className="px-6 py-14 text-center text-sm text-destructive" role="alert">
          {linearError}
        </div>
      ) : visible.length === 0 ? (
        <div className="px-6 py-14 text-center text-sm text-muted-foreground">
          {linearIssues.length === 0
            ? "No Linear issues yet. Create one with New."
            : "No Linear issues match this filter."}
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {visible.map((issue) => (
            <LinearIssueRow key={issue.identifier} model={model} issue={issue} />
          ))}
        </ul>
      )}
      <TaskPageLinearConnectDialog
        open={linearConnectOpen}
        onOpenChange={setLinearConnectOpen}
        onConnected={refreshLinearStatus}
      />
    </div>
  );
}
