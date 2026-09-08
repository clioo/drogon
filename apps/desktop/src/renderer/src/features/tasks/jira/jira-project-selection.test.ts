// R17-C: ports of the fork's task-page-jira-project-selection tests
// (src/renderer/src/components/task-page-jira-project-selection.test.ts)
// and jira-project-picker-filter tests.
import { describe, expect, it } from "vitest";
import {
  compareJiraProjectsByDisplayLabel,
  getJiraProjectSelectionKey,
} from "./jira-project-selection";
import {
  JIRA_PROJECT_PICKER_QUERY_MAX_BYTES,
  filterJiraProjectPickerProjects,
  getJiraProjectPickerDisplayLabel,
  isJiraProjectPickerQueryTooLarge,
} from "./jira-project-picker-filter";
import type { JiraProject } from "../../../../../shared/jira-contract";

function project(overrides: Partial<JiraProject> = {}): JiraProject {
  return { id: "1", key: "AA", name: "Alpha", ...overrides };
}

describe("getJiraProjectSelectionKey", () => {
  it("qualifies the project id with its site id", () => {
    expect(getJiraProjectSelectionKey(project({ id: "10", siteId: "site-1" }))).toBe("site-1:10");
  });

  it('falls back to the "selected" site sentinel when siteId is absent', () => {
    expect(getJiraProjectSelectionKey(project({ id: "10" }))).toBe("selected:10");
  });

  it("treats an empty siteId as a real site id", () => {
    expect(getJiraProjectSelectionKey(project({ id: "10", siteId: "" }))).toBe(":10");
  });
});

describe("compareJiraProjectsByDisplayLabel", () => {
  const sortOf = (projects: JiraProject[], includeSiteName: boolean): string[] =>
    [...projects]
      .sort((a, b) => compareJiraProjectsByDisplayLabel(a, b, includeSiteName))
      .map((entry) => `${entry.siteName ?? ""}/${entry.name}/${entry.key}`);

  it("orders by site name first when site names are included", () => {
    const projects = [
      project({ name: "Alpha", key: "AA", siteName: "Zeta" }),
      project({ name: "Beta", key: "BB", siteName: "Acme" }),
    ];
    expect(sortOf(projects, true)).toEqual(["Acme/Beta/BB", "Zeta/Alpha/AA"]);
  });

  it("ignores site name when it is not included", () => {
    const projects = [
      project({ name: "Alpha", key: "AA", siteName: "Zeta" }),
      project({ name: "Beta", key: "BB", siteName: "Acme" }),
    ];
    expect(sortOf(projects, false)).toEqual(["Zeta/Alpha/AA", "Acme/Beta/BB"]);
  });

  it("falls back to project name, then project key", () => {
    const projects = [
      project({ name: "Alpha", key: "AB" }),
      project({ name: "Alpha", key: "AA" }),
      project({ name: "Beta", key: "BA" }),
    ];
    expect(sortOf(projects, false)).toEqual(["/Alpha/AA", "/Alpha/AB", "/Beta/BA"]);
  });
});

describe("jira-project-picker-filter", () => {
  function fullProject(overrides: Partial<JiraProject> = {}): JiraProject {
    return {
      id: "10000",
      key: "APP",
      name: "Application",
      siteId: "site-1",
      siteName: "Engineering",
      ...overrides,
    };
  }

  it("formats project labels with optional site names", () => {
    const candidate = fullProject();
    expect(getJiraProjectPickerDisplayLabel(candidate, true)).toBe(
      "Engineering · Application (APP)",
    );
    expect(getJiraProjectPickerDisplayLabel(candidate, false)).toBe("Application (APP)");
  });

  it("matches project labels, keys, names, and site names", () => {
    const projects = [
      fullProject({ id: "1", key: "APP", name: "Application", siteName: "Engineering" }),
      fullProject({ id: "2", key: "OPS", name: "Operations", siteName: "Support" }),
    ];
    expect(
      filterJiraProjectPickerProjects({ projects, query: "ops", includeSiteName: true }),
    ).toEqual([projects[1]]);
    expect(
      filterJiraProjectPickerProjects({
        projects,
        query: "engineering",
        includeSiteName: true,
      }),
    ).toEqual([projects[0]]);
  });

  it("enforces the query budget by UTF-8 byte length", () => {
    const query = "é".repeat(JIRA_PROJECT_PICKER_QUERY_MAX_BYTES);
    expect(query.length).toBe(JIRA_PROJECT_PICKER_QUERY_MAX_BYTES);
    expect(isJiraProjectPickerQueryTooLarge(query)).toBe(true);
    expect(
      filterJiraProjectPickerProjects({ projects: [fullProject()], query, includeSiteName: true }),
    ).toEqual([]);
  });
});
