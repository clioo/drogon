// The ticket panel: its fields, the sessions linked to it (a click opens the
// session; one that is no longer running is resumed first), linking another
// session, and what its columns have sent.
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, GitPullRequest, Link2, Trash2, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import type { Session } from "../../../../shared/session-contract";
import type {
  WorkBoard,
  WorkBridge,
  WorkSend,
  WorkSession,
  WorkTicket,
  WorkTicketUpdate,
} from "../../../../shared/work-contract";
import type { WorkBoardState } from "./use-work-board";
import { deliverySummary, formatClock } from "./work-format";
import { WorkColumnIcon, WorkSessionGlyph, WorkSessionState, workSessionLabel } from "./work-icons";

export type WorkWorkspace = { id: string; name: string };

export function WorkTicketPanel({
  ticket,
  board,
  state,
  bridge,
  workspaces,
  listSessions,
  onOpenSession,
  onOpenExternal,
  onClose,
  onNotice,
}: {
  ticket: WorkTicket;
  board: WorkBoard;
  state: WorkBoardState;
  bridge: WorkBridge;
  workspaces: WorkWorkspace[];
  listSessions: () => Promise<Session[]>;
  onOpenSession: (session: WorkSession, ticket: WorkTicket) => void;
  onOpenExternal: (url: string) => void;
  onClose: () => void;
  onNotice: (message: string, kind?: "error" | "success") => void;
}) {
  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.description);
  const [pr, setPr] = useState(ticket.prUrl ?? (ticket.prNumber ? `#${ticket.prNumber}` : ""));
  const [source, setSource] = useState(ticket.sourceUrl ?? "");
  const [next, setNext] = useState(ticket.nextStep);
  const [sends, setSends] = useState<WorkSend[]>([]);
  const [candidates, setCandidates] = useState<Session[] | null>(null);
  const [linkChoice, setLinkChoice] = useState("");

  useEffect(() => {
    setTitle(ticket.title);
    setDescription(ticket.description);
    setPr(ticket.prUrl ?? (ticket.prNumber ? `#${ticket.prNumber}` : ""));
    setSource(ticket.sourceUrl ?? "");
    setNext(ticket.nextStep);
  }, [ticket.id, ticket.title, ticket.description, ticket.prUrl, ticket.prNumber, ticket.sourceUrl, ticket.nextStep]);

  useEffect(() => {
    let cancelled = false;
    void bridge.sends({ ticketId: ticket.id, limit: 20 }).then((result) => {
      if (!cancelled && result.ok) setSends(result.result.sends);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, ticket.id, ticket.updatedAt, board]);

  const workspaceName = useMemo(() => new Map(workspaces.map((w) => [w.id, w.name])), [workspaces]);
  const column = board.columns.find((c) => c.id === ticket.columnId);

  const update = async (patch: Omit<WorkTicketUpdate, "ticketId">) => {
    const result = await state.run(() => bridge.ticketUpdate({ ticketId: ticket.id, ...patch }));
    if (!result.ok) onNotice(result.error, "error");
  };
  const saveIfChanged = (value: string, current: string, patch: Omit<WorkTicketUpdate, "ticketId">) => {
    if (value !== current) void update(patch);
  };

  const loadCandidates = async () => {
    try {
      const all = await listSessions();
      const linked = new Set(ticket.sessions.map((s) => s.id));
      setCandidates(all.filter((s) => !linked.has(s.id)));
    } catch (err) {
      onNotice(err instanceof Error ? err.message : String(err), "error");
    }
  };

  return (
    <aside
      className="flex w-[380px] shrink-0 flex-col border-l border-border bg-background"
      aria-label={`Ticket ${ticket.key}`}
      data-testid="work-ticket-panel"
    >
      <header className="flex items-start gap-2 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs text-muted-foreground">{ticket.key}</p>
          <input
            aria-label="Ticket title"
            className="w-full truncate bg-transparent text-base font-semibold text-foreground outline-none focus:ring-1 focus:ring-ring rounded-sm"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => title.trim() && saveIfChanged(title, ticket.title, { title })}
          />
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="Close ticket panel" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4 text-sm">
        <section className="grid grid-cols-[88px_1fr] items-center gap-x-3 gap-y-2" aria-label="Details">
          <span className="text-xs text-muted-foreground">Column</span>
          <label className="flex items-center gap-2">
            {column ? <WorkColumnIcon icon={column.icon} className="size-3.5" /> : null}
            <select
              aria-label="Column"
              className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
              value={ticket.columnId}
              onChange={async (event) => {
                const result = await state.run(() =>
                  bridge.ticketMove({ ticketId: ticket.id, columnId: event.target.value }),
                );
                if (!result.ok) onNotice(result.error, "error");
                else if (result.value.delivery)
                  onNotice(`Sent to ${ticket.key}: ${deliverySummary(result.value.delivery.results)}`, "success");
              }}
            >
              {board.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <span className="text-xs text-muted-foreground">Project</span>
          <select
            aria-label="Project"
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
            value={ticket.projectId ?? ""}
            onChange={(event) => void update({ projectId: event.target.value || null })}
          >
            <option value="">No project</option>
            {board.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">Workspace</span>
          <select
            aria-label="Workspace"
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
            value={ticket.workspaceId ?? ""}
            onChange={(event) => void update({ workspaceId: event.target.value || null })}
          >
            <option value="">The project's</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">Pull request</span>
          <div className="flex items-center gap-1">
            <Input
              aria-label="Pull request"
              className="h-8"
              placeholder="URL or #number"
              value={pr}
              onChange={(event) => setPr(event.target.value)}
              onBlur={() =>
                saveIfChanged(pr, ticket.prUrl ?? (ticket.prNumber ? `#${ticket.prNumber}` : ""), {
                  prUrl: pr.trim() || null,
                })
              }
            />
            {ticket.prUrl ? (
              <Button variant="ghost" size="icon-xs" aria-label="Open pull request" onClick={() => onOpenExternal(ticket.prUrl!)}>
                <GitPullRequest />
              </Button>
            ) : null}
          </div>
          <span className="text-xs text-muted-foreground">Source</span>
          <div className="flex items-center gap-1">
            <Input
              aria-label="Source link"
              className="h-8"
              placeholder="https://… (GitHub, Jira, Linear)"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              onBlur={() => saveIfChanged(source, ticket.sourceUrl ?? "", { sourceUrl: source.trim() || null })}
            />
            {ticket.sourceUrl ? (
              <Button variant="ghost" size="icon-xs" aria-label="Open source link" onClick={() => onOpenExternal(ticket.sourceUrl!)}>
                <ExternalLink />
              </Button>
            ) : null}
          </div>
          <span className="text-xs text-muted-foreground">Next step</span>
          <Input
            aria-label="Next step"
            className="h-8"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            onBlur={() => saveIfChanged(next, ticket.nextStep, { nextStep: next })}
          />
        </section>

        <Textarea
          aria-label="Description"
          className="min-h-[90px]"
          placeholder="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => saveIfChanged(description, ticket.description, { description })}
        />

        <section className="space-y-2" aria-label="Sessions">
          <h3 className="text-sm font-semibold text-foreground">
            Sessions <span className="font-normal text-muted-foreground">{ticket.sessions.length}</span>
          </h3>
          {ticket.sessions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No linked sessions. A column prompt starts one in the ticket's workspace.
            </p>
          ) : (
            <ul className="space-y-1">
              {ticket.sessions.map((session) => (
                <li key={session.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:opacity-60"
                    aria-label={`Open ${workSessionLabel(session)} session ${session.id.slice(0, 8)}`}
                    disabled={session.missing === true}
                    onClick={() => onOpenSession(session, ticket)}
                    data-work-session={session.id}
                  >
                    <WorkSessionGlyph session={session} />
                    <span className="min-w-0 flex-1 truncate">
                      {workSessionLabel(session)}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {session.workspaceId ? workspaceName.get(session.workspaceId) ?? "" : ""}
                      </span>
                    </span>
                    <WorkSessionState session={session} />
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Unlink session ${session.id.slice(0, 8)}`}
                    onClick={async () => {
                      const result = await state.run(() =>
                        bridge.unlinkSession({ ticketId: ticket.id, sessionId: session.id }),
                      );
                      if (!result.ok) onNotice(result.error, "error");
                    }}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {candidates === null ? (
            <Button variant="outline" size="sm" onClick={() => void loadCandidates()}>
              <Link2 /> Link a session
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <select
                aria-label="Session to link"
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
                value={linkChoice}
                onChange={(event) => setLinkChoice(event.target.value)}
              >
                <option value="">Choose a session…</option>
                {candidates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {workSessionLabel(s as unknown as WorkSession)} · {workspaceName.get(s.workspaceId) ?? "workspace"} · {s.verdict}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={!linkChoice}
                onClick={async () => {
                  const result = await state.run(() =>
                    bridge.linkSession({ ticketId: ticket.id, sessionId: linkChoice }),
                  );
                  if (!result.ok) onNotice(result.error, "error");
                  setCandidates(null);
                  setLinkChoice("");
                }}
              >
                Link
              </Button>
            </div>
          )}
        </section>

        <section className="space-y-2" aria-label="Sent">
          <h3 className="text-sm font-semibold text-foreground">Sent</h3>
          {sends.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing sent to this ticket yet.</p>
          ) : (
            <ul className="space-y-2">
              {sends.map((send) => (
                <li key={send.id} className="rounded-md border border-border p-2 text-xs">
                  <div className="mb-1 flex items-center justify-between text-muted-foreground">
                    <span>
                      {board.columns.find((c) => c.id === send.columnId)?.name ?? "Column"} · {send.trigger}
                    </span>
                    <span>{formatClock(send.at)}</span>
                  </div>
                  <p className="line-clamp-2 text-foreground">{send.message}</p>
                  <p className="mt-1 text-muted-foreground">{deliverySummary(send.results)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <footer className="border-t border-border px-5 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={async () => {
            const result = await state.run(() => bridge.ticketDelete({ ticketId: ticket.id }));
            if (result.ok) {
              onNotice(`Deleted ${ticket.key}`, "success");
              onClose();
            } else onNotice(result.error, "error");
          }}
        >
          <Trash2 /> Delete ticket
        </Button>
      </footer>
    </aside>
  );
}
