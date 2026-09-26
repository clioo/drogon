// @vitest-environment jsdom
// The import dialog's board picker, mounted alone against a recording fake
// bridge: a filter by name or project (every word, Enter picks a lone
// match) and "Recommended for you" — the boards holding your open issues,
// most first — above the rest.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { TooltipProvider } from "../../components/ui/tooltip";
import type { Result } from "../../../../shared/session-contract";
import type { WorkBridge, WorkSource } from "../../../../shared/work-contract";
import { WorkImportDialog } from "./WorkImportDialog";

beforeAll(() => installRadixJsdomStubs());
afterEach(() => cleanup());

const ok = <T,>(result: T): Promise<Result<T>> =>
  Promise.resolve({ ok: true, result });

const LINEAR: WorkSource = {
  id: "linear",
  name: "Linear",
  enabled: true,
  connected: true,
  account: null,
  via: "token",
  apiUrl: null,
  error: null,
  boardTerm: "team",
  sprintTerm: "cycle",
  connect: "api_key",
  helpUrl: null,
  boards: 0,
};

function team(
  id: string,
  name: string,
  key: string | null,
  assignedOpen?: number,
) {
  return {
    id,
    name,
    kind: "kanban",
    projectKey: key,
    projectName: name,
    importedBoardId: null,
    ...(assignedOpen === undefined ? {} : { assignedOpen }),
  };
}

function mount(boards: ReturnType<typeof team>[]) {
  const bridge = {
    providerBoards: vi.fn(() => ok({ provider: "linear", boards })),
    // Never answers: the test only watches which board was asked for.
    importPreview: vi.fn(() => new Promise(() => {})),
  };
  render(
    <TooltipProvider>
      <WorkImportDialog
        open
        bridge={bridge as unknown as WorkBridge}
        source={LINEAR}
        projects={[]}
        onClose={vi.fn()}
        onImported={vi.fn()}
        onOpenExternal={vi.fn()}
      />
    </TooltipProvider>,
  );
  return bridge;
}

const chooseNames = (region: HTMLElement) =>
  within(region)
    .getAllByRole("button", { name: /^Choose / })
    .map((b) => b.getAttribute("aria-label"));

describe("board picker", () => {
  test("recommends the teams holding your open issues, most first, above the rest", async () => {
    mount([
      team("team-web", "Web Platform", "WEB", 0),
      team("team-eng", "Engineering", "ENG", 2),
      team("team-ops", "Operations", "OPS", 5),
      team("team-data", "Data Science", "DS"),
    ]);
    const dialog = await screen.findByTestId("work-import-dialog");
    const recommended = await within(dialog).findByRole("region", {
      name: "Recommended for you",
    });
    expect(chooseNames(recommended)).toEqual([
      "Choose Operations",
      "Choose Engineering",
    ]);
    expect(within(recommended).getByText("5 assigned to you")).toBeTruthy();
    expect(within(recommended).getByText("2 assigned to you")).toBeTruthy();
    const all = within(dialog).getByRole("region", { name: "All teams" });
    expect(chooseNames(all)).toEqual([
      "Choose Web Platform",
      "Choose Data Science",
    ]);
    expect(within(all).queryByText(/assigned to you/)).toBeNull();
  });

  test("filters by name or project key, says when nothing matches, and Enter picks a lone match", async () => {
    const bridge = mount([
      team("team-web", "Web Platform", "WEB", 0),
      team("team-ops", "Operations", "OPS", 5),
      team("team-data", "Data Science", "DS"),
    ]);
    const dialog = await screen.findByTestId("work-import-dialog");
    const filter = await within(dialog).findByRole("textbox", {
      name: "Filter teams",
    });

    fireEvent.change(filter, { target: { value: "ds" } });
    expect(
      within(dialog).queryByRole("region", { name: "Recommended for you" }),
    ).toBeNull();
    expect(chooseNames(dialog)).toEqual(["Choose Data Science"]);

    fireEvent.change(filter, { target: { value: "nothing like it" } });
    expect(
      within(dialog).getByText("No teams match “nothing like it”."),
    ).toBeTruthy();
    expect(
      within(dialog).queryAllByRole("button", { name: /^Choose / }),
    ).toHaveLength(0);

    fireEvent.change(filter, { target: { value: "operat" } });
    fireEvent.keyDown(filter, { key: "Enter" });
    await waitFor(() =>
      expect(bridge.importPreview).toHaveBeenCalledWith(
        expect.objectContaining({
          externalBoardId: "team-ops",
          provider: "linear",
        }),
      ),
    );
  });

  test("Enter does nothing while several boards still show; without counts there are no groups", async () => {
    const bridge = mount([team("one", "One", null), team("two", "Two", null)]);
    const dialog = await screen.findByTestId("work-import-dialog");
    const filter = await within(dialog).findByRole("textbox", {
      name: "Filter teams",
    });
    fireEvent.keyDown(filter, { key: "Enter" });
    expect(bridge.importPreview).not.toHaveBeenCalled();
    expect(chooseNames(dialog)).toEqual(["Choose One", "Choose Two"]);
    expect(
      within(dialog).queryByRole("region", { name: "Recommended for you" }),
    ).toBeNull();
    expect(within(dialog).queryByText(/^All teams/)).toBeNull();
  });

  test("reopening the dialog starts with an empty filter", async () => {
    const boards = [team("one", "One", null), team("two", "Two", null)];
    const bridge = {
      providerBoards: vi.fn(() => ok({ provider: "linear", boards })),
      importPreview: vi.fn(() => new Promise(() => {})),
    };
    const dialog = (open: boolean) => (
      <TooltipProvider>
        <WorkImportDialog
          open={open}
          bridge={bridge as unknown as WorkBridge}
          source={LINEAR}
          projects={[]}
          onClose={vi.fn()}
          onImported={vi.fn()}
          onOpenExternal={vi.fn()}
        />
      </TooltipProvider>
    );
    const { rerender } = render(dialog(true));
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Filter teams" }),
      { target: { value: "one" } },
    );
    expect(screen.queryByRole("button", { name: "Choose Two" })).toBeNull();
    rerender(dialog(false));
    rerender(dialog(true));
    const filter = await screen.findByRole("textbox", { name: "Filter teams" });
    expect((filter as HTMLInputElement).value).toBe("");
    expect(
      await screen.findByRole("button", { name: "Choose Two" }),
    ).toBeTruthy();
  });

  test("an account with no boards says so and shows no filter", async () => {
    mount([]);
    const dialog = await screen.findByTestId("work-import-dialog");
    expect(
      await within(dialog).findByText(
        "Linear has no teams this account can see.",
      ),
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole("textbox", { name: "Filter teams" }),
    ).toBeNull();
  });
});
