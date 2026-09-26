// The board picker's filter and "Recommended for you" grouping.
import { describe, expect, test } from "vitest";
import { assignedLabel, filterBoards, groupBoards, type PickerBoard } from "./work-board-picker";

function board(id: string, name: string, extra: Partial<PickerBoard> = {}): PickerBoard {
  return { id, name, kind: "kanban", projectKey: null, projectName: null, importedBoardId: null, ...extra };
}

const BOARDS = [
  board("1", "ZOPR Decommision Requests", { projectKey: "ZOPR", projectName: "Zillow Operations Production Release" }),
  board("2", "Renter Transactions Web and Services"),
  board("3", "Pathfinders OnCall", { projectKey: "ZHLCX", projectName: "Zillow Home Loans - Pathfinders" }),
  board("4", "Diseño de Producto", { projectKey: "DP" }),
];

describe("filterBoards", () => {
  test("a blank query keeps every board", () => {
    expect(filterBoards(BOARDS, "   ")).toBe(BOARDS);
  });

  test("matches the name, the project key and the project name, ignoring case", () => {
    expect(filterBoards(BOARDS, "renter").map((b) => b.id)).toEqual(["2"]);
    expect(filterBoards(BOARDS, "zhlcx").map((b) => b.id)).toEqual(["3"]);
    expect(filterBoards(BOARDS, "home loans").map((b) => b.id)).toEqual(["3"]);
    expect(filterBoards(BOARDS, "zillow").map((b) => b.id)).toEqual(["1", "3"]);
  });

  test("every word must match, in any order, and accents do not matter", () => {
    expect(filterBoards(BOARDS, "release zopr").map((b) => b.id)).toEqual(["1"]);
    expect(filterBoards(BOARDS, "zopr renter")).toEqual([]);
    expect(filterBoards(BOARDS, "diseno").map((b) => b.id)).toEqual(["4"]);
  });
});

describe("groupBoards", () => {
  test("boards with your open issues come first, most first, ties in listed order", () => {
    const boards = [
      board("a", "A"),
      board("b", "B", { assignedOpen: 1 }),
      board("c", "C", { assignedOpen: 4 }),
      board("d", "D", { assignedOpen: 1 }),
      board("e", "E", { assignedOpen: 0 }),
    ];
    const { recommended, rest } = groupBoards(boards);
    expect(recommended.map((b) => b.id)).toEqual(["c", "b", "d"]);
    expect(rest.map((b) => b.id)).toEqual(["a", "e"]);
  });

  test("a daemon without counts recommends nothing", () => {
    const { recommended, rest } = groupBoards(BOARDS);
    expect(recommended).toEqual([]);
    expect(rest).toEqual(BOARDS);
  });
});

test("assignedLabel reads naturally", () => {
  expect(assignedLabel(1)).toBe("1 assigned to you");
  expect(assignedLabel(4)).toBe("4 assigned to you");
});
