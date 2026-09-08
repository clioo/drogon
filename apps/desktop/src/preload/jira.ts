import { ipcRenderer } from "electron";
import type { JiraBridge } from "../shared/jira-contract";

/** `window.drogon.jira.*` namespace; channels are handled by main/jira-bridge.ts. */
export const jira: JiraBridge = {
  jiraConnect: (value) => ipcRenderer.invoke("drogon:jiraConnect", value),
  jiraDisconnect: (value) =>
    ipcRenderer.invoke("drogon:jiraDisconnect", value),
  jiraSelectSite: (value) =>
    ipcRenderer.invoke("drogon:jiraSelectSite", value),
  jiraStatus: () => ipcRenderer.invoke("drogon:jiraStatus"),
  jiraTestConnection: (value) =>
    ipcRenderer.invoke("drogon:jiraTestConnection", value),
  jiraSearchIssues: (value) =>
    ipcRenderer.invoke("drogon:jiraSearchIssues", value),
  jiraCancelSearchIssues: (value) =>
    ipcRenderer.invoke("drogon:jiraCancelSearchIssues", value),
  jiraListIssues: (value) =>
    ipcRenderer.invoke("drogon:jiraListIssues", value),
  jiraListProjects: (value) =>
    ipcRenderer.invoke("drogon:jiraListProjects", value),
  jiraListIssueTypes: (value) =>
    ipcRenderer.invoke("drogon:jiraListIssueTypes", value),
  jiraListCreateFields: (value) =>
    ipcRenderer.invoke("drogon:jiraListCreateFields", value),
  jiraListPriorities: (value) =>
    ipcRenderer.invoke("drogon:jiraListPriorities", value),
  jiraSearchUsers: (value) =>
    ipcRenderer.invoke("drogon:jiraSearchUsers", value),
  jiraGetIssue: (value) => ipcRenderer.invoke("drogon:jiraGetIssue", value),
  jiraComments: (value) => ipcRenderer.invoke("drogon:jiraComments", value),
  jiraListTransitions: (value) =>
    ipcRenderer.invoke("drogon:jiraListTransitions", value),
  jiraCreateIssue: (value) =>
    ipcRenderer.invoke("drogon:jiraCreateIssue", value),
  jiraUpdateIssue: (value) =>
    ipcRenderer.invoke("drogon:jiraUpdateIssue", value),
  jiraAddComment: (value) =>
    ipcRenderer.invoke("drogon:jiraAddComment", value),
  jiraStartIssue: (value) =>
    ipcRenderer.invoke("drogon:jiraStartIssue", value),
};
