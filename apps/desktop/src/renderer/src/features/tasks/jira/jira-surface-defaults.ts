// R17-B: default field values for the Jira slice of TaskPageModel, so the
// chrome tests' baseModel fixtures stay one spread away from type-complete
// (the fork's giant model made every stage field required; same here). The
// bridge/dialog stubs are inert: every RPC fails closed and the dialog is
// closed, matching a disconnected off-app render.
import type { JiraBridge } from "../../../../../shared/jira-contract";
import type { TaskPageJiraModelFields } from "../task-page-model";
import { getJiraPresets } from "../task-page-localized-options";
import type { JiraIssueCreationDialogState } from "./use-jira-issue-creation";

/** Refused stub for the granted `window.drogon.jira` namespace (off-app). */
export function jiraSurfaceRefusedBridge(): JiraBridge {
  const refused = () =>
    Promise.resolve({
      ok: false as const,
      error: {
        code: "unsupported_capability",
        message: "jira.v1 capability is not advertised by the service",
        retryable: true,
      },
    });
  return new Proxy({} as JiraBridge, {
    get: (_target, prop) => {
      if (prop === "then") return undefined;
      return refused;
    },
  });
}

/**
 * Inert create-dialog state: closed, empty lists, no-op setters. A Proxy
 * keeps the stub one place instead of mirroring the hook's ~40 fields; the
 * dialog only destructures, never iterates keys.
 */
export function jiraSurfaceCreationDialogDefaults(): JiraIssueCreationDialogState {
  const values: Record<string, unknown> = {
    open: false,
    title: "",
    body: "",
    submitting: false,
    projectsLoading: false,
    includeSiteNameInProjectLabel: false,
    sortedProjects: [],
    filteredProjects: [],
    projectQuery: "",
    projectComboboxOpen: false,
    projectCommandValue: "",
    targetProject: null,
    targetProjectKey: null,
    availableIssueTypes: [],
    issueTypesLoading: false,
    targetTypeId: null,
    targetType: null,
    createFieldsLoading: false,
    createFieldsError: null,
    visibleCreateFields: [],
    hasMissingJiraCreateField: false,
    customFieldValues: {},
    projectSearchInputRef: { current: null },
  };
  return new Proxy(values, {
    get: (target, prop: string) => {
      if (prop in target) return target[prop];
      return () => {};
    },
  }) as unknown as JiraIssueCreationDialogState;
}

/** Disconnected, idle Jira surface — the chrome tests' starting point. */
export function jiraSurfaceModelDefaults(): TaskPageJiraModelFields {
  return {
    onSelectTaskSource: () => {},
    hideTaskSource: () => {},
    jiraStatus: null,
    jiraStatusReady: true,
    jiraConnected: false,
    jiraSites: [],
    selectedJiraSiteId: null,
    onSelectJiraSite: () => {},
    jiraConnectOpen: false,
    setJiraConnectOpen: () => {},
    refreshJiraStatus: () => {},
    jiraPresets: getJiraPresets(),
    jiraLoading: false,
    jiraSearchInput: "",
    setJiraSearchInput: () => {},
    setAppliedJiraSearch: () => {},
    activeJiraPreset: "assigned",
    onSelectJiraPreset: () => {},
    handleRefreshJiraIssues: () => {},
    jiraProjectsLoading: false,
    sortedAvailableJiraProjects: [],
    onOpenNewJiraIssue: () => {},
    jiraIssues: [],
    jiraError: null,
    jiraErrorDetailsOpen: false,
    setJiraErrorDetailsOpen: () => {},
    jiraOrderBy: "updated",
    jiraOrderDirection: "desc",
    handleJiraSort: () => {},
    sortedJiraIssues: [],
    selectedJiraIssue: null,
    openJiraDetailPage: () => {},
    closeJiraDetailPage: () => {},
    handleUseJiraItem: () => {},
    jiraWorkspaceBridge: jiraSurfaceRefusedBridge(),
    jiraWorkspaceSiteId: null,
    openJiraIssueUrl: () => {},
    writeJiraClipboardText: () => {},
    onJiraIssuePatched: () => {},
    jiraCreationDialog: jiraSurfaceCreationDialogDefaults(),
  };
}
