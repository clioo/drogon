import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  GIT_CAPABILITY,
  type GitBridge,
  type GitStatusEntry,
} from "../../../../shared/git-contract";
import type {
  Result,
  Session,
  Status,
  Workspace,
} from "../../../../shared/session-contract";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  badgeFor,
  canCommit,
  groupChanges,
  type ChangeGroup,
} from "./changes-grouping";
import { parseUnifiedDiff } from "./unified-diff";

export const CHANGES_ROUTE_ID = "changes";
export const CHANGES_TITLE = "Changes";

/** Pure capability gate: does the service expose the git contract? */
export function isChangesAvailable(capabilities: readonly string[]): boolean {
  return capabilities.includes(GIT_CAPABILITY);
}

export type ChangesPanelProps = {
  routeId: string;
  session: Session | null;
  workspace: Workspace;
  status: Status;
  restoreState?: unknown;
  focusTarget: HTMLElement | null;
};

export type ChangesPanelDescriptor = {
  id: string;
  title: string;
  component: (props: ChangesPanelProps) => ReactNode;
  capability: string;
};

type Selection = { path: string; staged: boolean };

type StatusLoad =
  | { phase: "loading" }
  | { phase: "ready"; entries: GitStatusEntry[]; truncated: boolean }
  | { phase: "error"; message: string };

type DiffLoad =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; diff: string; truncated: boolean }
  | { phase: "error"; message: string };

function errorMessage(value: Result<unknown>): string {
  if (value.ok) return "";
  return value.error.message || `Request failed (${value.error.code}).`;
}

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)" };
const rowButton: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  textAlign: "left",
  padding: "6px 10px",
  borderRadius: "calc(var(--radius) * 0.8)",
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--foreground)",
  cursor: "pointer",
  fontSize: 13,
};
const badge: React.CSSProperties = {
  ...mono,
  fontSize: 11,
  border: "1px solid var(--border)",
  borderRadius: "calc(var(--radius) * 0.6)",
  padding: "1px 6px",
  flexShrink: 0,
};

export type ChangesViewData = {
  branchHead: string | null;
  ahead: number | null;
  hasUpstream: boolean;
  staged: GitStatusEntry[];
  unstaged: GitStatusEntry[];
  untracked: GitStatusEntry[];
  statusTruncated: boolean;
  selection: Selection | null;
  diff: DiffLoad;
  commitMessage: string;
  commitReady: boolean;
  pushEnabled: boolean;
  pushTitle: string;
  busy: string | null;
  notice: string | null;
  prUrl: string | null;
};

export type ChangesViewCallbacks = {
  onSelect: (selection: Selection) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onCommitMessage: (message: string) => void;
  onCommit: () => void;
  onPush: () => void;
  onPrCreate: () => void;
  onRefresh: () => void;
};

function GroupList({
  title,
  entries,
  group,
  selection,
  busy,
  actionLabel,
  onSelect,
  onAction,
}: {
  title: string;
  entries: GitStatusEntry[];
  group: ChangeGroup;
  selection: Selection | null;
  busy: boolean;
  actionLabel: string;
  onSelect: (path: string) => void;
  onAction: (paths: string[]) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <h3 style={{ fontSize: 12, color: "var(--muted-foreground)", margin: 0 }}>
          {title} ({entries.length})
        </h3>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => onAction(entries.map((e) => e.path))}
        >
          {actionLabel}
        </Button>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {entries.map((entry) => {
          const stagedView = group === "staged";
          const selected =
            selection !== null &&
            selection.path === entry.path &&
            selection.staged === stagedView;
          return (
            <li key={`${group}:${entry.path}`}>
              <button
                type="button"
                style={{
                  ...rowButton,
                  ...(selected
                    ? { background: "var(--sidebar-accent)" }
                    : undefined),
                }}
                aria-current={selected}
                onClick={() => onSelect(entry.path)}
                title={
                  entry.kind === "rename" && entry.origPath
                    ? `renamed from ${entry.origPath}`
                    : entry.path
                }
              >
                <span style={badge}>{badgeFor(entry, group)}</span>
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {entry.path}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Pure presentational Changes view: every state renders from props, so tests pin it without effects. */
export function ChangesView({
  data,
  callbacks,
}: {
  data: ChangesViewData;
  callbacks: ChangesViewCallbacks;
}) {
  const diff =
    data.diff.phase === "ready"
      ? parseUnifiedDiff(data.diff.diff)
      : { hunks: [], truncated: false };
  return (
    <div
      className="changes-panel"
      style={{ display: "flex", flexDirection: "row", flex: 1, minHeight: 0 }}
    >
      <div
        aria-label="Changed files"
        style={{
          width: 280,
          flexShrink: 0,
          overflow: "auto",
          borderRight: "1px solid var(--border)",
          padding: 12,
        }}
      >
        <div style={{ marginBottom: 8, fontSize: 13 }}>
          <strong>Changes</strong>{" "}
          <span style={{ color: "var(--muted-foreground)" }}>
            {data.branchHead ? `on ${data.branchHead}` : "no branch"}
            {data.ahead !== null && data.ahead > 0 ? ` · ${data.ahead} ahead` : ""}
          </span>
        </div>
        {data.statusTruncated && (
          <p role="status" style={{ fontSize: 12 }}>
            Long change list truncated; narrow the workspace scope.
          </p>
        )}
        {data.staged.length + data.unstaged.length + data.untracked.length ===
          0 && <p style={{ fontSize: 13 }}>No changes.</p>}
        <GroupList
          title="Staged"
          entries={data.staged}
          group="staged"
          selection={data.selection}
          busy={data.busy !== null}
          actionLabel="Unstage all"
          onSelect={(path) => callbacks.onSelect({ path, staged: true })}
          onAction={callbacks.onUnstage}
        />
        <GroupList
          title="Unstaged"
          entries={data.unstaged}
          group="unstaged"
          selection={data.selection}
          busy={data.busy !== null}
          actionLabel="Stage all"
          onSelect={(path) => callbacks.onSelect({ path, staged: false })}
          onAction={callbacks.onStage}
        />
        <GroupList
          title="Untracked"
          entries={data.untracked}
          group="untracked"
          selection={data.selection}
          busy={data.busy !== null}
          actionLabel="Stage all"
          onSelect={(path) => callbacks.onSelect({ path, staged: false })}
          onAction={callbacks.onStage}
        />
      </div>
      <div
        aria-label="Diff and commit"
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--editor-surface)",
        }}
      >
        <div
          style={{
            padding: 12,
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <Input
            aria-label="Commit message"
            placeholder="Commit message"
            value={data.commitMessage}
            disabled={data.busy !== null}
            onChange={(event) => callbacks.onCommitMessage(event.target.value)}
          />
          <Button
            size="sm"
            disabled={!data.commitReady || data.busy !== null}
            title={
              !data.commitReady
                ? "Stage changes and write a message to commit"
                : "Commit staged changes"
            }
            onClick={callbacks.onCommit}
          >
            {data.busy === "commit" ? "Committing…" : "Commit"}
          </Button>
        </div>
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <Button
            size="sm"
            variant="outline"
            disabled={!data.pushEnabled || data.busy !== null}
            title={data.pushTitle}
            onClick={callbacks.onPush}
          >
            {data.busy === "push" ? "Pushing…" : "Push"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={data.busy !== null}
            title="Create a pull request with gh"
            onClick={callbacks.onPrCreate}
          >
            {data.busy === "pr" ? "Creating PR…" : "New PR"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={data.busy !== null}
            onClick={callbacks.onRefresh}
          >
            Refresh
          </Button>
          {data.prUrl && (
            <span style={{ fontSize: 12 }}>
              PR:{" "}
              <a href={data.prUrl} target="_blank" rel="noreferrer">
                {data.prUrl}
              </a>
            </span>
          )}
        </div>
        {data.notice && (
          <div role={data.notice.startsWith("Error") ? "alert" : "status"}>
            <p style={{ fontSize: 12, padding: "4px 12px" }}>{data.notice}</p>
          </div>
        )}
        <div
          aria-label="Unified diff"
          style={{ flex: 1, overflow: "auto", padding: 12, ...mono, fontSize: 12 }}
        >
          {data.diff.phase === "idle" && <p>Select a file to view its diff.</p>}
          {data.diff.phase === "loading" && <p>Loading diff…</p>}
          {data.diff.phase === "error" && (
            <p role="alert">{data.diff.message}</p>
          )}
          {data.diff.phase === "ready" && diff.hunks.length === 0 && (
            <p>No diff for this file (untracked files show no diff).</p>
          )}
          {data.diff.phase === "ready" &&
            diff.hunks.map((hunk, index) => (
              <div key={index} style={{ marginBottom: 8 }}>
                {hunk.header && (
                  <div style={{ color: "var(--muted-foreground)" }}>
                    {hunk.header}
                  </div>
                )}
                {hunk.lines.map((line, lineIndex) => (
                  <div
                    key={lineIndex}
                    style={
                      line.kind === "add"
                        ? {
                            background:
                              "color-mix(in srgb, var(--foreground) 8%, transparent)",
                          }
                        : line.kind === "del"
                          ? {
                              color: "var(--destructive)",
                              background:
                                "color-mix(in srgb, var(--destructive) 8%, transparent)",
                            }
                          : line.kind === "hunk" ||
                              line.kind === "file" ||
                              line.kind === "noeol"
                            ? { color: "var(--muted-foreground)" }
                            : undefined
                    }
                  >
                    {line.text === "" ? " " : line.text}
                  </div>
                ))}
              </div>
            ))}
          {data.diff.phase === "ready" &&
            (diff.truncated || data.diff.truncated) && (
              <p role="status">Diff truncated to the display budget.</p>
            )}
        </div>
      </div>
    </div>
  );
}

/** Effectful container: loads status/diff through the injected GitBridge. */
export function ChangesPanel({
  workspace,
  status,
  bridge,
}: ChangesPanelProps & { bridge: GitBridge }) {
  const scope = useMemo(
    () => ({ hostId: status.hostId, workspaceId: workspace.id }),
    [status.hostId, workspace.id],
  );
  const [load, setLoad] = useState<StatusLoad>({ phase: "loading" });
  const [branch, setBranch] = useState<{
    head: string | null;
    ahead: number | null;
    upstream: boolean;
  }>({ head: null, ahead: null, upstream: false });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<DiffLoad>({ phase: "idle" });
  const [commitMessage, setCommitMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ phase: "loading" });
    void bridge.gitStatus(scope).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoad({ phase: "error", message: errorMessage(result) });
        return;
      }
      setLoad({
        phase: "ready",
        entries: result.result.entries,
        truncated: result.result.truncated,
      });
      setBranch({
        head: result.result.branch.head ?? null,
        ahead: result.result.branch.ahead ?? null,
        upstream: result.result.branch.upstream != null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, scope, revision]);

  useEffect(() => {
    if (!selection) {
      setDiff({ phase: "idle" });
      return;
    }
    let cancelled = false;
    setDiff({ phase: "loading" });
    void bridge
      .gitDiff({ ...scope, path: selection.path, staged: selection.staged })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setDiff({ phase: "error", message: errorMessage(result) });
          return;
        }
        setDiff({
          phase: "ready",
          diff: result.result.diff,
          truncated: result.result.truncated,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, scope, selection]);

  const mutate = useCallback(
    async (kind: string, run: () => Promise<Result<unknown>>) => {
      setBusy(kind);
      setNotice(null);
      try {
        const result = await run();
        if (!result.ok) {
          setNotice(`Error: ${errorMessage(result)}`);
          return false;
        }
        return true;
      } finally {
        setBusy(null);
        setRevision((value) => value + 1);
      }
    },
    [],
  );

  const entries = load.phase === "ready" ? load.entries : [];
  const grouped = useMemo(() => groupChanges(entries), [entries]);
  const ahead = branch.ahead;
  const pushEnabled = branch.upstream && (ahead ?? 0) > 0;
  const pushTitle = !branch.upstream
    ? "No upstream branch: push from a terminal once to set one"
    : (ahead ?? 0) > 0
      ? `Push ${ahead} commit${ahead === 1 ? "" : "s"} upstream`
      : "Already up to date with upstream";

  const data: ChangesViewData = {
    branchHead: branch.head,
    ahead,
    hasUpstream: branch.upstream,
    staged: grouped.staged,
    unstaged: grouped.unstaged,
    untracked: grouped.untracked,
    statusTruncated: load.phase === "ready" && load.truncated,
    selection,
    diff,
    commitMessage,
    commitReady:
      commitMessage.trim().length > 0 && canCommit(entries),
    pushEnabled: pushEnabled === true,
    pushTitle,
    busy,
    notice:
      load.phase === "error"
        ? `Error: ${load.message}`
        : notice,
    prUrl,
  };
  const callbacks: ChangesViewCallbacks = {
    onSelect: setSelection,
    onStage: (paths) =>
      void mutate("stage", () => bridge.gitStage({ ...scope, paths })),
    onUnstage: (paths) =>
      void mutate("unstage", () => bridge.gitUnstage({ ...scope, paths })),
    onCommitMessage: setCommitMessage,
    onCommit: () =>
      void mutate("commit", () =>
        bridge.gitCommit({ ...scope, message: commitMessage }),
      ).then((ok) => {
        if (ok) setCommitMessage("");
      }),
    onPush: () => void mutate("push", () => bridge.gitPush(scope)),
    onPrCreate: () =>
      void (async () => {
        setBusy("pr");
        setNotice(null);
        try {
          const title =
            commitMessage.trim() ||
            (selection ? `Update ${selection.path}` : "Update");
          const result = await bridge.gitPrCreate({ ...scope, title });
          if (!result.ok) {
            setNotice(`Error: ${errorMessage(result)}`);
            return;
          }
          setPrUrl(result.result.url);
          setNotice(`PR created: ${result.result.url}`);
        } finally {
          setBusy(null);
          setRevision((value) => value + 1);
        }
      })(),
    onRefresh: () => setRevision((value) => value + 1),
  };
  return <ChangesView data={data} callbacks={callbacks} />;
}

export function createChangesPanelDescriptor(deps: {
  bridge: GitBridge;
}): ChangesPanelDescriptor {
  return {
    id: CHANGES_ROUTE_ID,
    title: CHANGES_TITLE,
    component: (props: ChangesPanelProps) => (
      <ChangesPanel {...props} bridge={deps.bridge} />
    ),
    capability: GIT_CAPABILITY,
  };
}
