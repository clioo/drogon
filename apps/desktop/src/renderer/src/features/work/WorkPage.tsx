// The Work page: Drogon tickets on a board of configurable columns (Board),
// the same tickets as a table (List), and the external systems they link to
// (Sources). A column's "…" opens its prompt panel; a ticket opens its own
// panel, where each linked session opens (or resumes) in one click.
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Clock3,
  ExternalLink,
  Filter,
  Folder,
  GitPullRequest,
  Link2,
  ListTree,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import type { Session } from "../../../../shared/session-contract";
import {
  WORK_COLUMN_ICONS,
  type WorkBoard,
  type WorkBridge,
  type WorkColumn,
  type WorkSession,
  type WorkTicket,
} from "../../../../shared/work-contract";
import { useWorkBoard } from "./use-work-board";
import {
  columnTriggerLabel,
  deliverySummary,
  formatClock,
  isLiveSession,
  matchesFilter,
  matchesSearch,
  sessionCountLabel,
  sourceKind,
  ticketIsWorking,
  WORK_FILTER_LABELS,
  type WorkFilter,
} from "./work-format";
import { WorkColumnIcon } from "./work-icons";
import { WorkColumnPanel } from "./WorkColumnPanel";
import { WorkTicketPanel, type WorkWorkspace } from "./WorkTicketPanel";

const TICKET_MIME = "application/x-drogon-work-ticket";

type Panel = { kind: "column"; id: string } | { kind: "ticket"; id: string } | null;
type Tab = "board" | "list" | "sources";

export type WorkSessionTarget = { workspaceId: string; sessionId: string };

/** The view the page returns to after a remount (Settings, a reload of the
 *  shell): the tab and the open panel, for this renderer's lifetime. */
const lastView: { tab: Tab; panel: Panel } = { tab: "board", panel: null };

/** Test seam: forget the remembered view. */
export function resetWorkViewMemoryForTests(): void {
  lastView.tab = "board";
  lastView.panel = null;
}

export function WorkPage({
  bridge,
  active = true,
  workspaces,
  onOpenSession,
  onOpenExternal = (url) => {
    void (window as unknown as { drogon?: { shell?: { openExternal?: (u: string) => unknown } } }).drogon?.shell?.openExternal?.(url);
  },
  listSessions = defaultListSessions,
  onClose,
}: {
  bridge: WorkBridge | null;
  active?: boolean;
  workspaces: WorkWorkspace[];
  /** Selects the session's workspace and focuses its terminal tab. */
  onOpenSession: (target: WorkSessionTarget) => void;
  onOpenExternal?: (url: string) => void;
  listSessions?: () => Promise<Session[]>;
  onClose?: () => void;
}) {
  const state = useWorkBoard(bridge, active);
  const [tab, setTabState] = useState<Tab>(lastView.tab);
  const setTab = (next: Tab) => {
    lastView.tab = next;
    setTabState(next);
  };
  const [project, setProject] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WorkFilter>("all");
  const [panel, setPanelState] = useState<Panel>(lastView.panel);
  const setPanel = (next: Panel) => {
    lastView.panel = next;
    setPanelState(next);
  };
  const [newTicketColumn, setNewTicketColumn] = useState<string | null>(null);
  const [newColumnOpen, setNewColumnOpen] = useState(false);

  const notice = (message: string, kind: "error" | "success" = "success") => {
    if (kind === "error") toast.error(message);
    else toast.success(message);
  };

  const board = state.board;
  const visibleTickets = useMemo(
    () =>
      (board?.tickets ?? []).filter(
        (t) => (!project || t.projectId === project) && matchesSearch(t, query) && matchesFilter(t, filter),
      ),
    [board, project, query, filter],
  );

  const openSession = async (session: WorkSession, ticket: WorkTicket) => {
    if (!bridge) return;
    if (isLiveSession(session) && session.workspaceId) {
      onOpenSession({ workspaceId: session.workspaceId, sessionId: session.id });
      return;
    }
    const result = await state.run(() => bridge.sessionOpen({ ticketId: ticket.id, sessionId: session.id }));
    if (!result.ok) {
      notice(result.error, "error");
      return;
    }
    const opened = result.value;
    if (opened.action === "resumed") notice(`Resumed ${ticket.key}'s session`);
    else if (opened.action === "started") notice(`Nothing to resume: started a new session for ${ticket.key}`);
    const workspaceId = (opened.session.workspaceId as string | undefined) ?? session.workspaceId;
    if (workspaceId) onOpenSession({ workspaceId, sessionId: opened.session.id });
  };

  const move = async (ticketId: string, columnId: string, index?: number) => {
    if (!bridge) return;
    const result = await state.run(() => bridge.ticketMove({ ticketId, columnId, index }));
    if (!result.ok) notice(result.error, "error");
    else if (result.value.delivery)
      notice(`${result.value.key}: ${deliverySummary(result.value.delivery.results)}`);
  };

  const panelColumn = panel?.kind === "column" ? board?.columns.find((c) => c.id === panel.id) : undefined;
  const panelTicket = panel?.kind === "ticket" ? board?.tickets.find((t) => t.id === panel.id) : undefined;

  return (
    <main className="flex h-full min-h-0 w-full flex-col bg-background" aria-label="Work">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="shrink-0 px-6 pt-5">
            <div className="flex items-center gap-3">
              {onClose ? (
                <Button variant="ghost" size="icon-xs" aria-label="Close work" onClick={onClose}>
                  <X />
                </Button>
              ) : null}
              <h1 className="flex-1 text-2xl font-semibold tracking-tight text-foreground">Work</h1>
              <Button onClick={() => setNewTicketColumn(board?.columns[0]?.id ?? "")} disabled={!board}>
                <Plus /> New ticket
              </Button>
            </div>
            <div className="mt-3 flex gap-5 border-b border-border" role="tablist" aria-label="Work views">
              {(["board", "list", "sources"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className={`-mb-px border-b-2 px-1 pb-2 text-sm font-medium capitalize transition-colors ${
                    tab === t
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 py-3">
              <select
                aria-label="Project filter"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                value={project}
                onChange={(event) => setProject(event.target.value)}
              >
                <option value="">All projects</option>
                {(board?.projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="relative w-full max-w-sm">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search work"
                  className="h-9 pl-8"
                  placeholder="Search work…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="flex-1" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" aria-label="Filter">
                    <Filter /> {filter === "all" ? "Filter" : WORK_FILTER_LABELS[filter]}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup value={filter} onValueChange={(v) => setFilter(v as WorkFilter)}>
                    {(Object.keys(WORK_FILTER_LABELS) as WorkFilter[]).map((f) => (
                      <DropdownMenuRadioItem key={f} value={f}>
                        {WORK_FILTER_LABELS[f]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {state.error && !board ? (
            <p className="px-6 text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : !board ? (
            <p className="px-6 text-sm text-muted-foreground">Loading work…</p>
          ) : tab === "board" ? (
            <BoardView
              board={board}
              tickets={visibleTickets}
              selected={panel}
              onMove={move}
              onOpenColumn={(id) => setPanel({ kind: "column", id })}
              onOpenTicket={(id) => setPanel({ kind: "ticket", id })}
              onNewTicket={(columnId) => setNewTicketColumn(columnId)}
              onNewColumn={() => setNewColumnOpen(true)}
              onColumnAction={async (column, action) => {
                if (!bridge) return;
                if (action === "delete") {
                  const target = board.columns.find((c) => c.id !== column.id);
                  const result = await state.run(() =>
                    bridge.columnDelete({
                      columnId: column.id,
                      moveTicketsTo: column.ticketCount > 0 ? target?.id : undefined,
                    }),
                  );
                  if (!result.ok) notice(result.error, "error");
                  else if (panel?.kind === "column" && panel.id === column.id) setPanel(null);
                  return;
                }
                const index = action === "left" ? column.position - 1 : column.position + 1;
                const result = await state.run(() => bridge.columnUpdate({ columnId: column.id, index: Math.max(0, index) }));
                if (!result.ok) notice(result.error, "error");
              }}
              onRenameColumn={async (column, name) => {
                if (!bridge) return;
                const result = await state.run(() => bridge.columnUpdate({ columnId: column.id, name }));
                if (!result.ok) notice(result.error, "error");
              }}
              onIconColumn={async (column, icon) => {
                if (!bridge) return;
                const result = await state.run(() => bridge.columnUpdate({ columnId: column.id, icon }));
                if (!result.ok) notice(result.error, "error");
              }}
              onDeleteTicket={async (ticket) => {
                if (!bridge) return;
                const result = await state.run(() => bridge.ticketDelete({ ticketId: ticket.id }));
                if (!result.ok) notice(result.error, "error");
              }}
            />
          ) : tab === "list" ? (
            <ListView board={board} tickets={visibleTickets} onOpenTicket={(id) => setPanel({ kind: "ticket", id })} />
          ) : (
            <SourcesView tickets={visibleTickets} onOpenTicket={(id) => setPanel({ kind: "ticket", id })} onOpenExternal={onOpenExternal} />
          )}
        </div>
        {bridge && board && panelColumn ? (
          <WorkColumnPanel
            column={panelColumn}
            board={board}
            state={state}
            bridge={bridge}
            onClose={() => setPanel(null)}
            onNotice={notice}
          />
        ) : null}
        {bridge && board && panelTicket ? (
          <WorkTicketPanel
            ticket={panelTicket}
            board={board}
            state={state}
            bridge={bridge}
            workspaces={workspaces}
            listSessions={listSessions}
            onOpenSession={(session, ticket) => void openSession(session, ticket)}
            onOpenExternal={onOpenExternal}
            onClose={() => setPanel(null)}
            onNotice={notice}
          />
        ) : null}
      </div>
      {bridge && board ? (
        <NewTicketDialog
          open={newTicketColumn !== null}
          board={board}
          workspaces={workspaces}
          initialColumn={newTicketColumn ?? ""}
          initialProject={project}
          onClose={() => setNewTicketColumn(null)}
          onCreate={async (input) => {
            const result = await state.run(() => bridge.ticketCreate(input));
            if (!result.ok) return result.error;
            setNewTicketColumn(null);
            setPanel({ kind: "ticket", id: result.value.id });
            notice(`Created ${result.value.key}`);
            return null;
          }}
        />
      ) : null}
      {bridge ? (
        <NewColumnDialog
          open={newColumnOpen}
          onClose={() => setNewColumnOpen(false)}
          onCreate={async (name, icon) => {
            const result = await state.run(() => bridge.columnCreate({ name, icon }));
            if (!result.ok) return result.error;
            setNewColumnOpen(false);
            setPanel({ kind: "column", id: result.value.id });
            return null;
          }}
        />
      ) : null}
    </main>
  );
}

async function defaultListSessions(): Promise<Session[]> {
  const drogon = (window as unknown as { drogon?: { sessions?: (w?: string) => Promise<{ ok: boolean; result?: { sessions: Session[] }; error?: { message: string } }> } }).drogon;
  const reply = await drogon?.sessions?.(undefined);
  if (!reply?.ok || !reply.result) throw new Error(reply?.error?.message ?? "Sessions are unavailable.");
  return reply.result.sessions;
}

// ----------------------------------------------------------------- board --

function BoardView({
  board,
  tickets,
  selected,
  onMove,
  onOpenColumn,
  onOpenTicket,
  onNewTicket,
  onNewColumn,
  onColumnAction,
  onRenameColumn,
  onIconColumn,
  onDeleteTicket,
}: {
  board: WorkBoard;
  tickets: WorkTicket[];
  selected: Panel;
  onMove: (ticketId: string, columnId: string, index?: number) => void;
  onOpenColumn: (id: string) => void;
  onOpenTicket: (id: string) => void;
  onNewTicket: (columnId: string) => void;
  onNewColumn: () => void;
  onColumnAction: (column: WorkColumn, action: "left" | "right" | "delete") => void;
  onRenameColumn: (column: WorkColumn, name: string) => void;
  onIconColumn: (column: WorkColumn, icon: string) => void;
  onDeleteTicket: (ticket: WorkTicket) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 gap-0 overflow-x-auto px-3 pb-4" data-testid="work-board">
      {board.columns.map((column, index) => (
        <BoardColumn
          key={column.id}
          board={board}
          column={column}
          first={index === 0}
          last={index === board.columns.length - 1}
          tickets={tickets
            .filter((t) => t.columnId === column.id)
            .sort((a, b) => a.position - b.position)}
          configuring={selected?.kind === "column" && selected.id === column.id}
          selectedTicket={selected?.kind === "ticket" ? selected.id : null}
          onMove={onMove}
          onOpenColumn={onOpenColumn}
          onOpenTicket={onOpenTicket}
          onNewTicket={onNewTicket}
          onColumnAction={onColumnAction}
          onRenameColumn={onRenameColumn}
          onIconColumn={onIconColumn}
          onDeleteTicket={onDeleteTicket}
        />
      ))}
      <div className="w-12 shrink-0 pt-3">
        <Button variant="ghost" size="icon-sm" aria-label="New column" onClick={onNewColumn}>
          <Plus />
        </Button>
      </div>
    </div>
  );
}

function BoardColumn({
  board,
  column,
  first,
  last,
  tickets,
  configuring,
  selectedTicket,
  onMove,
  onOpenColumn,
  onOpenTicket,
  onNewTicket,
  onColumnAction,
  onRenameColumn,
  onIconColumn,
  onDeleteTicket,
}: {
  board: WorkBoard;
  column: WorkColumn;
  first: boolean;
  last: boolean;
  tickets: WorkTicket[];
  configuring: boolean;
  selectedTicket: string | null;
  onMove: (ticketId: string, columnId: string, index?: number) => void;
  onOpenColumn: (id: string) => void;
  onOpenTicket: (id: string) => void;
  onNewTicket: (columnId: string) => void;
  onColumnAction: (column: WorkColumn, action: "left" | "right" | "delete") => void;
  onRenameColumn: (column: WorkColumn, name: string) => void;
  onIconColumn: (column: WorkColumn, icon: string) => void;
  onDeleteTicket: (ticket: WorkTicket) => void;
}) {
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const trigger = columnTriggerLabel(column);

  const indexAt = (clientY: number): number => {
    const cards = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-work-ticket]") ?? [])];
    const at = cards.findIndex((card) => {
      const rect = card.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    return at === -1 ? cards.length : at;
  };

  return (
    <section
      className={`flex w-[272px] shrink-0 flex-col border-r border-border/60 px-2 last:border-r-0 ${dropIndex !== null ? "bg-accent/30" : ""}`}
      aria-label={`${column.name} column`}
      data-work-column={column.id}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(TICKET_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropIndex(indexAt(event.clientY));
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null);
      }}
      onDrop={(event) => {
        const ticketId = event.dataTransfer.getData(TICKET_MIME);
        const index = indexAt(event.clientY);
        setDropIndex(null);
        if (!ticketId) return;
        event.preventDefault();
        const ticket = board.tickets.find((t) => t.id === ticketId);
        // Dropping below itself in the same column shifts the index by one.
        const own = ticket?.columnId === column.id ? tickets.findIndex((t) => t.id === ticketId) : -1;
        onMove(ticketId, column.id, own !== -1 && own < index ? index - 1 : index);
      }}
    >
      <div className="flex items-start gap-2 px-1 pt-3 pb-2">
        <WorkColumnIcon icon={column.icon} className="mt-0.5 size-5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {renaming ? (
              <input
                aria-label="Column name"
                autoFocus
                defaultValue={column.name}
                className="w-full rounded-sm bg-transparent text-sm font-semibold outline-none ring-1 ring-ring"
                onBlur={(event) => {
                  setRenaming(false);
                  const name = event.target.value.trim();
                  if (name && name !== column.name) onRenameColumn(column, name);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                  if (event.key === "Escape") setRenaming(false);
                }}
              />
            ) : (
              <h2 className="truncate text-sm font-semibold text-foreground">{column.name}</h2>
            )}
            <span className="rounded-md bg-muted px-1.5 text-xs text-muted-foreground" aria-label={`${tickets.length} tickets`}>
              {tickets.length}
            </span>
          </div>
          {trigger ? <p className="truncate text-xs text-muted-foreground">{trigger}</p> : null}
        </div>
        <Button variant="ghost" size="icon-xs" aria-label={`New ticket in ${column.name}`} onClick={() => onNewTicket(column.id)}>
          <Plus />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`${column.name} column actions`}
              className={configuring ? "ring-1 ring-ring" : undefined}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onOpenColumn(column.id)}>Configure prompt…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Icon</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {WORK_COLUMN_ICONS.map((icon) => (
                  <DropdownMenuItem key={icon} onSelect={() => onIconColumn(column, icon)}>
                    <WorkColumnIcon icon={icon} className="size-4" /> {icon.replace("_", " ")}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem disabled={first} onSelect={() => onColumnAction(column, "left")}>
              Move left
            </DropdownMenuItem>
            <DropdownMenuItem disabled={last} onSelect={() => onColumnAction(column, "right")}>
              Move right
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={() => onColumnAction(column, "delete")}>
              Delete column
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div ref={listRef} className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto pb-2">
        {tickets.map((ticket, index) => (
          <div key={ticket.id}>
            {dropIndex === index ? <DropLine /> : null}
            <TicketCard
              ticket={ticket}
              board={board}
              selected={selectedTicket === ticket.id}
              onOpen={() => onOpenTicket(ticket.id)}
              onMove={(columnId) => onMove(ticket.id, columnId)}
              onDelete={() => onDeleteTicket(ticket)}
            />
          </div>
        ))}
        {dropIndex === tickets.length ? <DropLine /> : null}
      </div>
    </section>
  );
}

function DropLine() {
  return <div className="my-0.5 h-0.5 rounded-full bg-ring" data-testid="work-drop-indicator" />;
}

function TicketCard({
  ticket,
  board,
  selected,
  onOpen,
  onMove,
  onDelete,
}: {
  ticket: WorkTicket;
  board: WorkBoard;
  selected: boolean;
  onOpen: () => void;
  onMove: (columnId: string) => void;
  onDelete: () => void;
}) {
  const working = ticketIsWorking(ticket);
  return (
    <article
      className={`group rounded-lg border bg-card px-3 py-2.5 text-sm shadow-xs transition-colors ${
        selected ? "border-ring" : "border-border hover:border-foreground/20"
      }`}
      draggable
      data-work-ticket={ticket.id}
      aria-label={`${ticket.key} ${ticket.title}`}
      onDragStart={(event) => {
        event.dataTransfer.setData(TICKET_MIME, ticket.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">{ticket.key}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={`${ticket.key} actions`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onOpen}>Open</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {board.columns
                  .filter((c) => c.id !== ticket.columnId)
                  .map((c) => (
                    <DropdownMenuItem key={c.id} onSelect={() => onMove(c.id)}>
                      <WorkColumnIcon icon={c.icon} className="size-4" /> {c.name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <button
        type="button"
        className="mt-0.5 flex w-full items-start gap-2 text-left"
        aria-label={`Open ${ticket.key}: ${ticket.title}`}
        onClick={onOpen}
      >
        {working ? (
          <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-yellow-500" aria-label="Agent working" role="img" />
        ) : null}
        <span className="font-semibold leading-snug text-foreground">{ticket.title}</span>
      </button>
      <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
        {ticket.projectName ? (
          <li className="flex items-center gap-2">
            <Folder className="size-3.5" aria-hidden="true" /> {ticket.projectName}
          </li>
        ) : null}
        {ticket.prNumber || ticket.prUrl ? (
          <li className="flex items-center gap-2">
            <GitPullRequest className="size-3.5" aria-hidden="true" />
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-foreground">
              {ticket.prNumber ? `PR #${ticket.prNumber}` : "PR"}
            </span>
          </li>
        ) : null}
        <li className="flex items-center gap-2">
          {ticket.sessions.length > 1 ? (
            <Link2 className="size-3.5" aria-hidden="true" />
          ) : (
            <MessageSquare className="size-3.5" aria-hidden="true" />
          )}
          {ticket.sessions.length > 1 ? `${ticket.sessions.length} linked sessions` : sessionCountLabel(ticket)}
        </li>
        {ticket.nextStep ? (
          <li className="flex items-center gap-2">
            <ListTree className="size-3.5" aria-hidden="true" /> Next: {ticket.nextStep}
          </li>
        ) : null}
        {ticket.sessions.length > 0 ? (
          <li className="flex items-center gap-2">
            <Clock3 className="size-3.5" aria-hidden="true" /> Updated {formatClock(ticket.updatedAt)}
          </li>
        ) : null}
      </ul>
    </article>
  );
}

// ------------------------------------------------------------ list/sources --

function ListView({
  board,
  tickets,
  onOpenTicket,
}: {
  board: WorkBoard;
  tickets: WorkTicket[];
  onOpenTicket: (id: string) => void;
}) {
  const columnName = new Map(board.columns.map((c) => [c.id, c.name]));
  const order = new Map(board.columns.map((c) => [c.id, c.position]));
  const rows = [...tickets].sort(
    (a, b) => (order.get(a.columnId) ?? 0) - (order.get(b.columnId) ?? 0) || a.position - b.position,
  );
  if (rows.length === 0) return <p className="px-6 text-sm text-muted-foreground">No tickets.</p>;
  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 pb-4">
      <table className="w-full text-sm" aria-label="Tickets">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-2 font-medium">Key</th>
            <th className="py-2 font-medium">Title</th>
            <th className="py-2 font-medium">Column</th>
            <th className="py-2 font-medium">Project</th>
            <th className="py-2 font-medium">PR</th>
            <th className="py-2 font-medium">Sessions</th>
            <th className="py-2 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr
              key={t.id}
              className="cursor-pointer border-b border-border/60 hover:bg-accent/40"
              onClick={() => onOpenTicket(t.id)}
            >
              <td className="py-2 font-mono text-xs text-muted-foreground">{t.key}</td>
              <td className="py-2">
                <button type="button" className="text-left font-medium" onClick={() => onOpenTicket(t.id)}>
                  {t.title}
                </button>
              </td>
              <td className="py-2">{columnName.get(t.columnId)}</td>
              <td className="py-2 text-muted-foreground">{t.projectName ?? "—"}</td>
              <td className="py-2 text-muted-foreground">{t.prNumber ? `#${t.prNumber}` : "—"}</td>
              <td className="py-2 text-muted-foreground">{t.sessions.length}</td>
              <td className="py-2 text-muted-foreground">{formatClock(t.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourcesView({
  tickets,
  onOpenTicket,
  onOpenExternal,
}: {
  tickets: WorkTicket[];
  onOpenTicket: (id: string) => void;
  onOpenExternal: (url: string) => void;
}) {
  const linked = tickets.filter((t) => t.sourceUrl);
  const groups = new Map<string, WorkTicket[]>();
  for (const t of linked) {
    const kind = sourceKind(t.sourceUrl);
    groups.set(kind, [...(groups.get(kind) ?? []), t]);
  }
  const unlinked = tickets.length - linked.length;
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-auto px-6 pb-4" data-testid="work-sources">
      <p className="text-sm text-muted-foreground">
        Tickets are Drogon records; each can link the ticket it tracks in another system.
        {unlinked > 0 ? ` ${unlinked} ticket${unlinked === 1 ? " has" : "s have"} no source link.` : ""}
      </p>
      {[...groups.entries()].map(([kind, rows]) => (
        <section key={kind} aria-label={`${kind} sources`}>
          <h2 className="mb-2 text-sm font-semibold text-foreground">
            {kind} <span className="font-normal text-muted-foreground">{rows.length}</span>
          </h2>
          <ul className="divide-y divide-border/60 rounded-lg border border-border">
            {rows.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <button type="button" className="font-mono text-xs text-muted-foreground" onClick={() => onOpenTicket(t.id)}>
                  {t.key}
                </button>
                <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => onOpenTicket(t.id)}>
                  {t.title}
                </button>
                <Button variant="ghost" size="xs" onClick={() => onOpenExternal(t.sourceUrl!)}>
                  <ExternalLink aria-hidden="true" />
                  <span className="max-w-[320px] truncate">{t.sourceUrl}</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- dialogs --

function NewTicketDialog({
  open,
  board,
  workspaces,
  initialColumn,
  initialProject,
  onClose,
  onCreate,
}: {
  open: boolean;
  board: WorkBoard;
  workspaces: WorkWorkspace[];
  initialColumn: string;
  initialProject: string;
  onClose: () => void;
  onCreate: (input: {
    title: string;
    columnId?: string;
    projectId?: string;
    workspaceId?: string;
    prUrl?: string;
    sourceUrl?: string;
    description?: string;
  }) => Promise<string | null>;
}) {
  const [title, setTitle] = useState("");
  const [columnId, setColumnId] = useState(initialColumn);
  const [projectId, setProjectId] = useState(initialProject);
  const [workspaceId, setWorkspaceId] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) {
    setLastOpen(true);
    setTitle("");
    setColumnId(initialColumn || board.columns[0]?.id || "");
    setProjectId(initialProject);
    setWorkspaceId("");
    setPrUrl("");
    setSourceUrl("");
    setDescription("");
    setError(null);
  } else if (!open && lastOpen) {
    setLastOpen(false);
  }
  const column = board.columns.find((c) => c.id === columnId);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New ticket</DialogTitle>
          <DialogDescription>
            A Drogon ticket with its own key. Link the issue it tracks elsewhere and the sessions
            working on it; its column's prompt reaches them.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          aria-label="New ticket"
          onSubmit={async (event) => {
            event.preventDefault();
            const failure = await onCreate({
              title: title.trim(),
              columnId: columnId || undefined,
              projectId: projectId || undefined,
              workspaceId: workspaceId || undefined,
              prUrl: prUrl.trim() || undefined,
              sourceUrl: sourceUrl.trim() || undefined,
              description: description || undefined,
            });
            setError(failure);
          }}
        >
          <Input aria-label="Title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <select aria-label="Column" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
              {board.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select aria-label="Project" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project</option>
              {board.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <select aria-label="Workspace" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
            <option value="">Sessions start in the project's workspace</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <Input aria-label="Pull request" placeholder="Pull request (URL or #number)" value={prUrl} onChange={(e) => setPrUrl(e.target.value)} />
          <Input aria-label="Source link" placeholder="Source link (GitHub, Jira, Linear…)" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
          <Textarea aria-label="Description" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          {column?.sendOnEnter && column.message.trim() ? (
            <p className="text-xs text-muted-foreground">
              {column.name} sends its prompt when a ticket enters it: creating this ticket there sends it now.
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              Create ticket
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewColumnDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, icon: string) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("todo");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New column</DialogTitle>
          <DialogDescription>Columns can type a prompt into their tickets' sessions.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          aria-label="New column"
          onSubmit={async (event) => {
            event.preventDefault();
            const failure = await onCreate(name.trim(), icon);
            setError(failure);
            if (!failure) setName("");
          }}
        >
          <Input aria-label="Column name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <select aria-label="Column icon" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={icon} onChange={(e) => setIcon(e.target.value)}>
            {WORK_COLUMN_ICONS.map((i) => (
              <option key={i} value={i}>
                {i.replace("_", " ")}
              </option>
            ))}
          </select>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Add column
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
