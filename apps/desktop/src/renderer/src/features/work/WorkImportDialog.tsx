// Import a source's board (a Jira board, a Linear team, a GitHub project or
// repository): pick the board that frames the import, then choose which of
// its issues come in. The first import creates the board's columns from the
// source's (mapped to its statuses); later ones add issues, and issues
// already on the board are shown as such. A source that is allowed but not
// connected yet shows its connect form first.
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import type {
  WorkBoardSummary,
  WorkBridge,
  WorkImportPreview,
  WorkProviderBoard,
  WorkProviderIssue,
  WorkSource,
} from "../../../../shared/work-contract";
import { IssueTypeBadge, ProviderMark, capitalize } from "./work-sources";
import { boardsTerm, WorkSourceConnectForm } from "./WorkSources";

type Group = { id: string; label: string; issues: WorkProviderIssue[] };

/** Issues grouped the way a scrum board reads: active sprint, upcoming
 *  sprints, backlog, then what already finished in a past sprint. */
export function groupIssues(preview: WorkImportPreview, sprintTerm = "sprint"): Group[] {
  if (preview.board.kind !== "scrum") {
    return [{ id: "all", label: "Issues", issues: preview.issues }];
  }
  const groups: Group[] = [];
  const open = preview.sprints.filter((s) => s.state === "active").concat(preview.sprints.filter((s) => s.state === "future"));
  for (const sprint of open) {
    const issues = preview.issues.filter((i) => i.sprint?.id === sprint.id);
    if (issues.length) {
      groups.push({
        id: `sprint:${sprint.id}`,
        label: `${sprint.name} · ${sprint.state === "active" ? "Active" : "Upcoming"}`,
        issues,
      });
    }
  }
  const unsprinted = preview.issues.filter((i) => !i.sprint || !open.some((s) => s.id === i.sprint?.id));
  const finished = unsprinted.filter((i) => i.status.category === "done" && i.closedSprints.length > 0);
  const backlog = unsprinted.filter((i) => !finished.includes(i));
  if (backlog.length) groups.push({ id: "backlog", label: "Backlog", issues: backlog });
  if (finished.length) groups.push({ id: "finished", label: `Finished in past ${sprintTerm}s`, issues: finished });
  return groups;
}

export function WorkImportDialog({
  open,
  bridge,
  source,
  projects,
  initialBoard,
  onClose,
  onImported,
  onOpenExternal,
  onOpenTasks,
  onSourceChanged,
}: {
  open: boolean;
  bridge: WorkBridge;
  /** The source to import from. */
  source: WorkSource;
  projects: { id: string; name: string }[];
  /** Skip straight to the issue picker of this provider board. */
  initialBoard?: { externalId: string; projectId?: string | null } | null;
  onClose: () => void;
  onImported: (board: WorkBoardSummary, imported: number) => void;
  onOpenExternal: (url: string) => void;
  onOpenTasks?: () => void;
  /** A connection made from the dialog: the page reloads its sources. */
  onSourceChanged?: () => void;
}) {
  const provider = source.id;
  const [needsConnect, setNeedsConnect] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [boards, setBoards] = useState<WorkProviderBoard[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [external, setExternal] = useState<string | null>(null);
  const [preview, setPreview] = useState<WorkImportPreview | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPreview(null);
    setChosen(new Set());
    setProjectId(initialBoard?.projectId ?? "");
    setExternal(initialBoard?.externalId ?? null);
    setNeedsConnect(false);
    if (initialBoard) return;
    setBoards(null);
    let cancelled = false;
    void bridge.providerBoards({ provider }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setBoards(result.result.boards);
        setWarnings(result.result.warnings ?? []);
      } else if (/_not_connected$/.test(result.error.code)) setNeedsConnect(true);
      else setError(result.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [open, bridge, initialBoard, provider, attempt]);

  useEffect(() => {
    if (!open || !external) return;
    let cancelled = false;
    setPreview(null);
    setError(null);
    void bridge.importPreview({ externalBoardId: external, provider }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setPreview(result.result);
      // Start from the active sprint's issues that are not in yet.
      const active = result.result.sprints.find((s) => s.state === "active");
      const initial = result.result.issues.filter(
        (i) => !i.importedTicketId && (result.result.board.kind !== "scrum" ? false : i.sprint?.id === active?.id),
      );
      setChosen(new Set(initial.map((i) => i.key)));
    });
    return () => {
      cancelled = true;
    };
  }, [open, bridge, external, provider]);

  const groups = useMemo(() => (preview ? groupIssues(preview, source.sprintTerm) : []), [preview, source.sprintTerm]);
  const toggle = (keys: string[], on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });

  const importNow = async () => {
    if (!external || chosen.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.boardImport({
        provider,
        externalBoardId: external,
        issueKeys: [...chosen],
        projectId: projectId || undefined,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onImported(result.result.board, result.result.imported);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="work-import-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ProviderMark provider={provider} className="size-4" />
            {preview ? `Import from ${preview.board.name}` : `Import a ${source.name} ${source.boardTerm}`}
          </DialogTitle>
          <DialogDescription>
            {preview
              ? `Choose the issues to bring in. Each keeps its ${source.name} key, and its column's prompts reach the sessions you link to it.`
              : needsConnect
                ? `Connect ${source.name} to see its ${boardsTerm(source)}.`
                : `Pick the ${source.name} ${source.boardTerm} that frames the import: its columns and ${source.sprintTerm}s come with it.`}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {!external && warnings.length ? (
          <div className="space-y-1" data-testid="work-import-warnings">
            {warnings.map((w) => (
              <p key={w} className="rounded-md border border-amber-500/40 bg-amber-500/8 px-3 py-2 text-xs text-amber-700 dark:text-amber-300" role="status">
                {w}
              </p>
            ))}
          </div>
        ) : null}

        {needsConnect && !external ? (
          <WorkSourceConnectForm
            source={source}
            bridge={bridge}
            onOpenExternal={onOpenExternal}
            onOpenTasks={onOpenTasks}
            onConnected={() => {
              onSourceChanged?.();
              setNeedsConnect(false);
              setAttempt((n) => n + 1);
            }}
          />
        ) : !external ? (
          boards === null && !error ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading {source.name} {boardsTerm(source)}…
            </p>
          ) : (
            <ul className="max-h-[360px] space-y-1 overflow-y-auto" aria-label={`${source.name} boards`}>
              {(boards ?? []).map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => setExternal(b.id)}
                    aria-label={`Choose ${b.name}`}
                  >
                    <ProviderMark provider={provider} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">{b.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {b.kind === "scrum" ? `${capitalize(source.sprintTerm)}s` : "Kanban"}
                        {b.projectKey ? ` · ${b.projectKey}` : ""}
                        {b.projectName && b.projectName !== b.name ? ` · ${b.projectName}` : ""}
                      </span>
                    </span>
                    {b.importedBoardId ? (
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Imported</span>
                    ) : null}
                  </button>
                </li>
              ))}
              {boards && boards.length === 0 ? (
                <li className="text-sm text-muted-foreground">
                  {source.name} has no {boardsTerm(source)} this account can see.
                </li>
              ) : null}
            </ul>
          )
        ) : !preview && !error ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Reading the board…
          </p>
        ) : preview ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground" data-testid="work-import-columns">
              Columns: {preview.columns.map((c) => c.name).join(" · ")}
            </p>
            {preview.truncated ? (
              <p className="text-xs text-amber-600 dark:text-amber-400" role="status">
                Showing {preview.issues.length} of {preview.total} issues. Import these, then import more later.
              </p>
            ) : null}
            <div className="max-h-[340px] space-y-4 overflow-y-auto pr-1" aria-label="Issues">
              {groups.map((group) => {
                const selectable = group.issues.filter((i) => !i.importedTicketId).map((i) => i.key);
                const all = selectable.length > 0 && selectable.every((k) => chosen.has(k));
                return (
                  <section key={group.id} aria-label={group.label}>
                    <label className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                      <Checkbox
                        checked={all}
                        disabled={selectable.length === 0}
                        aria-label={`All of ${group.label}`}
                        onCheckedChange={(checked) => toggle(selectable, checked === true)}
                      />
                      {group.label} <span className="font-normal">{group.issues.length}</span>
                    </label>
                    <ul className="divide-y divide-border/60 rounded-md border border-border">
                      {group.issues.map((issue) => (
                        <li key={issue.key} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                          <Checkbox
                            checked={issue.importedTicketId ? true : chosen.has(issue.key)}
                            disabled={Boolean(issue.importedTicketId)}
                            aria-label={`Import ${issue.key}`}
                            onCheckedChange={(checked) => toggle([issue.key], checked === true)}
                          />
                          <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{issue.key}</span>
                          <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                          <IssueTypeBadge type={issue.issueType} />
                          <span className="w-24 shrink-0 truncate text-right text-xs text-muted-foreground">
                            {issue.importedTicketId ? "On the board" : issue.status.name}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Sessions start in</span>
              <select
                aria-label="Drogon project for sessions"
                className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">Choose per ticket later</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <DialogFooter>
          {external && !initialBoard ? (
            <Button variant="ghost" className="mr-auto" onClick={() => setExternal(null)}>
              <ArrowLeft /> {capitalize(boardsTerm(source))}
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {preview ? (
            <Button disabled={busy || chosen.size === 0} onClick={() => void importNow()}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              Import {chosen.size} {chosen.size === 1 ? "issue" : "issues"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
