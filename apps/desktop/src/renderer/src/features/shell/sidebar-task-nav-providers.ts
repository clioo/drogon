// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/shared/task-providers.ts (filterAvailableTaskProviders semantics) for
// the sidebar Tasks nav chips (#346). Adaptations: the fork reads persisted
// settings plus preflight/Linear status, and keeps GitHub and Jira
// unconditionally visible; Drogon has no visibleTaskProviders setting yet,
// so the full provider list is the baseline, GitHub is gated on the gh auth
// probe, Jira on a connected site (jira.status), and GitLab/Linear stay
// dark until an integration exists to gate them.
import type { TaskSource } from "../tasks/task-source-navigation";

export type TaskProvider = TaskSource;

export const TASK_PROVIDERS: readonly TaskProvider[] = [
  "github",
  "gitlab",
  "linear",
  "jira",
];

export type TaskProviderAvailability = {
  githubConnected: boolean;
  gitlabInstalled: boolean;
  linearConnected: boolean;
  jiraConnected: boolean;
};

export function filterAvailableTaskProviders(
  visibleProviders: readonly TaskProvider[],
  availability: TaskProviderAvailability,
): TaskProvider[] {
  // Why: unlike the fork (which must keep one provider selectable for the
  // page), an all-unavailable result is fine here — the Tasks row button
  // itself stays the entry point, so no chip may advertise a provider
  // that is not connected (#346).
  return visibleProviders.filter((provider) =>
    isTaskProviderAvailable(provider, availability),
  );
}

function isTaskProviderAvailable(
  provider: TaskProvider,
  availability: TaskProviderAvailability,
): boolean {
  if (provider === "github") {
    return availability.githubConnected;
  }
  if (provider === "gitlab") {
    return availability.gitlabInstalled;
  }
  if (provider === "jira") {
    return availability.jiraConnected;
  }
  return availability.linearConnected;
}
