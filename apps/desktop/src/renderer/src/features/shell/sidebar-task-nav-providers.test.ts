// MIT Copyright (c) 2026 Lovecast Inc. Sidebar Tasks nav chips (#346):
// the fork's filterAvailableTaskProviders semantics mirrored against
// Drogon's provider state — GitHub gated on the gh probe, Jira on a
// connected site, GitLab/Linear dark without an integration.
import { describe, expect, test } from "vitest";
import {
  filterAvailableTaskProviders,
  TASK_PROVIDERS,
  type TaskProviderAvailability,
} from "./sidebar-task-nav-providers";

const none: TaskProviderAvailability = {
  githubConnected: false,
  gitlabInstalled: false,
  linearConnected: false,
  jiraConnected: false,
};

describe("filterAvailableTaskProviders", () => {
  test("hides every chip when nothing is connected — the row button stays the entry point", () => {
    expect(filterAvailableTaskProviders(TASK_PROVIDERS, none)).toEqual([]);
  });

  test("shows GitHub only when gh is installed and logged in", () => {
    expect(
      filterAvailableTaskProviders(TASK_PROVIDERS, {
        ...none,
        githubConnected: true,
      }),
    ).toEqual(["github"]);
  });

  test("shows the Jira chip only when a site is connected", () => {
    expect(
      filterAvailableTaskProviders(TASK_PROVIDERS, {
        ...none,
        jiraConnected: true,
      }),
    ).toEqual(["jira"]);
    expect(
      filterAvailableTaskProviders(TASK_PROVIDERS, {
        ...none,
        githubConnected: true,
        jiraConnected: true,
      }),
    ).toEqual(["github", "jira"]);
  });

  test("keeps the fork's task-provider order in the result", () => {
    expect(
      filterAvailableTaskProviders(TASK_PROVIDERS, {
        githubConnected: true,
        gitlabInstalled: true,
        linearConnected: true,
        jiraConnected: true,
      }),
    ).toEqual(["github", "gitlab", "linear", "jira"]);
  });

  test("an empty input list stays empty", () => {
    expect(filterAvailableTaskProviders([], none)).toEqual([]);
  });
});
