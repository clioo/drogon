// R17-C: the Tasks page's Jira create dialog, issue detail workspace and
// start-from-issue helpers (ported from the orca-drogon fork; each file
// cites its source). R17-B's list surface owns the chrome these mount into.
export { JiraIssueCreateDialog } from "./jira-issue-create-dialog";
export {
  useJiraIssueCreationDialog,
  type JiraIssueCreationDialogProps,
  type JiraIssueCreationDialogState,
} from "./use-jira-issue-creation";
export { default as JiraIssueWorkspace } from "./jira-issue-workspace";
export { getJiraIssueWorkspaceActions } from "./jira-issue-workspace-actions";
export {
  buildJiraStartIssuePrompt,
  buildJiraIssueContextPrompt,
  startWorkspaceFromJiraIssue,
  type JiraStartIssueOutcome,
} from "./use-jira-start-issue";
export {
  getJiraIssueWorkspaceSeed,
  getJiraLinkedWorkItemWorkspaceName,
  getLinkedWorkItemSuggestedName,
  slugifyForWorkspaceName,
} from "./jira-workspace-seed";
export {
  isVisibleJiraCreateField,
  isJiraUserCreateField,
  isJiraScalarUserCreateField,
  getJiraUserCreateFieldKeys,
  buildJiraCreateCustomFields,
} from "./jira-create-fields";
export { JiraUserPicker, JiraUserOptionList } from "./jira-user-picker";
export { JiraMarkdown } from "./jira-markdown";
export { JiraIcon } from "./jira-issue-workspace-content";
