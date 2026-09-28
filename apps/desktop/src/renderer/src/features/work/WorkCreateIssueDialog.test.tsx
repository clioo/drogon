// @vitest-environment jsdom
// The create form "+" opens on an imported board, mounted alone against a
// recording fake bridge: what each source asks for (nothing more for a
// Linear team, an issue type for Jira, a repository for a GitHub Project),
// the column's status line, the sprint it defaults to, and the exact
// `work.ticket_create` input it submits.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import type { Result } from "../../../../shared/session-contract";
import type {
  WorkBoard,
  WorkBoardSummary,
  WorkBridge,
  WorkColumn,
  WorkCreateOptions,
  WorkSprint,
  WorkTicketCreate,
} from "../../../../shared/work-contract";
import { WorkCreateIssueDialog, defaultSprint } from "./WorkCreateIssueDialog";

beforeAll(() => installRadixJsdomStubs());
afterEach(() => cleanup());

function column(id: string, name: string, status: string | null, extra: Partial<WorkColumn> = {}): WorkColumn {
  return {
    id,
    name,
    icon: "circle",
    position: 0,
    sendOnEnter: false,
    cron: null,
    prWatch: false,
    message: "",
    recipients: "all",
    harnessId: null,
    nextRunAt: null,
    ticketCount: 0,
    lastSentAt: null,
    lastSentCount: 0,
    statuses: status ? [{ id: `s-${id}`, name: status, category: "todo" }] : [],
    ...extra,
  };
}

const sprint = (id: string, state: string): WorkSprint => ({ id, name: `Sprint ${id}`, state, start: null, end: null });

function summary(provider: string, extra: Partial<WorkBoardSummary> = {}): WorkBoardSummary {
  return {
    id: `board-${provider}`,
    provider,
    name: `${provider} board`,
    kind: "kanban",
    statuses: [],
    pendingCount: 0,
    ticketCount: 0,
    ...extra,
  };
}

function board(columns: WorkColumn[], sprints: WorkSprint[] = [], view: Partial<NonNullable<WorkBoard["view"]>> = {}): WorkBoard {
  return {
    columns,
    tickets: [],
    projects: [],
    ...(sprints.length ? { view: { kind: "all", readOnly: false, promptsPaused: false, sprints, ...view } } : {}),
  };
}

function mount(opts: {
  provider: string;
  board: WorkBoard;
  summary?: WorkBoardSummary;
  initialColumn?: string;
  options?: Result<WorkCreateOptions> | Promise<Result<WorkCreateOptions>>;
  onCreate?: (input: WorkTicketCreate) => Promise<string | null>;
}) {
  const createOptions = vi.fn(() => Promise.resolve(opts.options ?? { ok: true, result: { provider: opts.provider, boardId: "b", issueTypes: [], repos: [] } }));
  const onCreate = vi.fn(opts.onCreate ?? (() => Promise.resolve(null)));
  render(
    <WorkCreateIssueDialog
      open
      bridge={{ createOptions } as unknown as WorkBridge}
      board={opts.board}
      summary={opts.summary ?? summary(opts.provider)}
      initialColumn={opts.initialColumn ?? ""}
      onClose={vi.fn()}
      onCreate={onCreate}
    />,
  );
  return { createOptions, onCreate };
}

const title = (text: string) => fireEvent.change(screen.getByLabelText("Title"), { target: { value: text } });
const submit = () => fireEvent.click(screen.getByRole("button", { name: /^Create in / }));

describe("WorkCreateIssueDialog", () => {
  test("a Linear team asks only for the issue and submits it into the chosen column", async () => {
    const cols = [column("todo", "Todo", "Todo"), column("doing", "In Progress", "In Progress")];
    const { createOptions, onCreate } = mount({ provider: "linear", board: board(cols), initialColumn: "doing" });

    expect(screen.getByText(/New Linear issue/)).toBeTruthy();
    expect(createOptions).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Issue type")).toBeNull();
    expect(screen.queryByLabelText("Repository")).toBeNull();
    expect(screen.getByTestId("work-create-issue-status").textContent).toBe("It starts in Linear as In Progress.");

    const create = screen.getByRole("button", { name: "Create in Linear" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    title("  Fix the login  ");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: " steps " } });
    fireEvent.click(screen.getByLabelText("Assign to me"));
    submit();

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]![0]).toEqual({
      boardId: "board-linear",
      title: "Fix the login",
      columnId: "doing",
      description: "steps",
      assignToMe: false,
    });
  });

  test("a Drogon-only column says the issue keeps the source's default", () => {
    mount({ provider: "linear", board: board([column("mine", "Parking lot", null)]) });
    expect(screen.getByTestId("work-create-issue-status").textContent).toBe(
      "Parking lot has no Linear status: the issue takes Linear's default and the card stays here.",
    );
  });

  test("Jira lists issue types from the source, Task first, and sends the chosen one", async () => {
    const { createOptions, onCreate } = mount({
      provider: "jira",
      board: board([column("todo", "To Do", "To Do")]),
      options: {
        ok: true,
        result: { provider: "jira", boardId: "board-jira", issueTypes: [{ id: "10001", name: "Task" }, { id: "10004", name: "Bug" }], repos: [] },
      },
    });
    expect(createOptions).toHaveBeenCalledWith({ boardId: "board-jira" });
    const types = (await screen.findByRole("option", { name: "Bug" })).closest("select") as HTMLSelectElement;
    expect(types.value).toBe("10001");
    fireEvent.change(types, { target: { value: "10004" } });
    title("Crash on save");
    submit();
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ boardId: "board-jira", issueType: "10004", assignToMe: true });
    expect(onCreate.mock.calls[0]![0]).not.toHaveProperty("repo");
  });

  test("a GitHub Project needs a repository it tracks; none blocks creating", async () => {
    const project = summary("github", { externalId: "project:PVT_1" });
    const { onCreate } = mount({
      provider: "github",
      summary: project,
      board: board([column("todo", "Todo", "Todo")]),
      options: { ok: true, result: { provider: "github", boardId: project.id, issueTypes: [], repos: [] } },
    });
    await screen.findByRole("option", { name: "No repository in this project yet" });
    title("Ship it");
    expect((screen.getByRole("button", { name: "Create in GitHub" }) as HTMLButtonElement).disabled).toBe(true);
    submit();
    expect(onCreate).not.toHaveBeenCalled();
  });

  test("a GitHub Project sends the repository picked", async () => {
    const project = summary("github", { externalId: "project:PVT_1" });
    const { onCreate } = mount({
      provider: "github",
      summary: project,
      board: board([column("todo", "Todo", "Todo")]),
      options: { ok: true, result: { provider: "github", boardId: project.id, issueTypes: [], repos: ["acme/api", "acme/web"] } },
    });
    const repos = (await screen.findByRole("option", { name: "acme/web" })).closest("select") as HTMLSelectElement;
    expect(repos.value).toBe("acme/api");
    fireEvent.change(repos, { target: { value: "acme/web" } });
    title("Ship it");
    submit();
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ repo: "acme/web" });
    expect(onCreate.mock.calls[0]![0]).not.toHaveProperty("issueType");
  });

  test("a source that cannot list its options says why and blocks creating", async () => {
    mount({
      provider: "jira",
      board: board([column("todo", "To Do", "To Do")]),
      options: { ok: false, error: { code: "unavailable", message: "Jira is not reachable." } } as Result<WorkCreateOptions>,
    });
    expect((await screen.findByRole("alert")).textContent).toBe("Jira is not reachable.");
    title("Anything");
    expect((screen.getByRole("button", { name: "Create in Jira" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("on a sprint board the issue goes into the active sprint unless another is picked", async () => {
    const sprints = [sprint("1", "closed"), sprint("2", "active"), sprint("3", "future")];
    const { onCreate } = mount({ provider: "linear", board: board([column("todo", "Todo", "Todo")], sprints) });
    const picker = screen.getByLabelText("Cycle") as HTMLSelectElement;
    expect(picker.value).toBe("2");
    expect(screen.queryByRole("option", { name: /Sprint 1/ })).toBeNull();
    fireEvent.change(picker, { target: { value: "backlog" } });
    title("Later");
    submit();
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ sprintId: "backlog" });
  });

  test("a failed create keeps the form open with the source's error", async () => {
    mount({
      provider: "linear",
      board: board([column("todo", "Todo", "Todo")]),
      onCreate: () => Promise.resolve("Linear refused the issue: title too long."),
    });
    title("x");
    submit();
    expect((await screen.findByRole("alert")).textContent).toBe("Linear refused the issue: title too long.");
    expect(screen.getByTestId("work-create-issue-dialog")).toBeTruthy();
  });
});

describe("defaultSprint", () => {
  const cols = [column("todo", "Todo", "Todo")];
  test("follows the view: the viewed open sprint, the backlog, else the active one", () => {
    const sprints = [sprint("1", "closed"), sprint("2", "active"), sprint("3", "future")];
    expect(defaultSprint(board(cols))).toBe("");
    expect(defaultSprint(board(cols, sprints))).toBe("2");
    expect(defaultSprint(board(cols, sprints, { kind: "backlog" }))).toBe("backlog");
    expect(defaultSprint(board(cols, sprints, { kind: "sprint", sprint: sprints[2] }))).toBe("3");
    expect(defaultSprint(board(cols, sprints, { kind: "sprint", sprint: sprints[0] }))).toBe("2");
    expect(defaultSprint(board(cols, [sprint("9", "future")]))).toBe("backlog");
  });
});
