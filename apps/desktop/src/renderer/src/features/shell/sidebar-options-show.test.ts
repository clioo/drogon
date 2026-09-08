/* MIT Copyright (c) 2026 Lovecast Inc.
   Show/Projects rows of the sidebar Options menu, adapted from Orca's
   SidebarRepositoryFilterSection: the visibility label vocabulary and the
   empty-means-all filter semantics. */
import { describe, expect, test } from "vitest";
import {
  filterGroupsBySelectedProjects,
  getProjectsFilterVisibilityLabel,
} from "./sidebar-options-show";
import type { ProjectGroup } from "./project-adapter";

function group(id: string, name: string): ProjectGroup {
  return {
    project: {
      id,
      hostId: "h1",
      path: `/work/${name}`,
      name,
      kind: "git",
      defaultBaseRef: null,
    },
    worktrees: [],
  };
}

describe("getProjectsFilterVisibilityLabel", () => {
  const projects = [group("a", "alpha").project, group("b", "beta").project];
  test("unsettled reads All projects", () => {
    expect(getProjectsFilterVisibilityLabel(projects, [])).toBe(
      "All projects",
    );
  });
  test("one selection names the project", () => {
    expect(getProjectsFilterVisibilityLabel(projects, ["b"])).toBe("beta");
  });
  test("several selections count up", () => {
    expect(getProjectsFilterVisibilityLabel(projects, ["a", "b"])).toBe(
      "2 projects",
    );
  });
  test("unknown ids never inflate the count", () => {
    expect(getProjectsFilterVisibilityLabel(projects, ["ghost"])).toBe(
      "All projects",
    );
    expect(getProjectsFilterVisibilityLabel(projects, ["a", "ghost"])).toBe(
      "alpha",
    );
  });
});

describe("filterGroupsBySelectedProjects", () => {
  const groups = [group("a", "alpha"), group("b", "beta")];
  test("empty selection keeps every group", () => {
    expect(filterGroupsBySelectedProjects(groups, [])).toEqual(groups);
  });
  test("selection narrows to the chosen projects", () => {
    expect(filterGroupsBySelectedProjects(groups, ["b"]).map((g) => g.project.id)).toEqual([
      "b",
    ]);
  });
});
