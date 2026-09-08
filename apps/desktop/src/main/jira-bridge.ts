import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import {
  jiraBridgeSchemas,
  jiraResultSchemas,
} from "../shared/jira-contract";
import { resultSchemas } from "../shared/result-validation";
import type { Result } from "../shared/session-contract";
import { callNative } from "./native-client";

// The jira result schemas live in shared/jira-contract.ts (this vertical's
// granted file) rather than shared/result-validation.ts (coordinator-owned):
// registering them here keeps native-client's `resultSchemas[method]` lookup
// exact without touching that file. If the coordinator later moves them into
// result-validation.ts, delete this loop — the keys are identical.
for (const [method, schema] of Object.entries(jiraResultSchemas)) {
  resultSchemas[method] = schema;
}

export type JiraMethod = keyof typeof jiraBridgeSchemas;
type NativeCall = (
  method: string,
  params: object,
  requestId?: string,
) => Promise<Result<unknown>>;

/** Channel → native method; names mirror the fork's IPC/RPC surface. */
const nativeMethodFor: Record<JiraMethod, string> = {
  jiraConnect: "jira.connect",
  jiraDisconnect: "jira.disconnect",
  jiraSelectSite: "jira.selectSite",
  jiraStatus: "jira.status",
  jiraTestConnection: "jira.testConnection",
  jiraSearchIssues: "jira.searchIssues",
  jiraCancelSearchIssues: "jira.cancelSearchIssues",
  jiraListIssues: "jira.listIssues",
  jiraListProjects: "jira.listProjects",
  jiraListIssueTypes: "jira.listIssueTypes",
  jiraListCreateFields: "jira.listCreateFields",
  jiraListPriorities: "jira.listPriorities",
  jiraSearchUsers: "jira.searchUsers",
  jiraGetIssue: "jira.getIssue",
  jiraComments: "jira.comments",
  jiraListTransitions: "jira.transitions",
  jiraCreateIssue: "jira.createIssue",
  jiraUpdateIssue: "jira.updateIssue",
  jiraAddComment: "jira.addComment",
  jiraStartIssue: "jira.startIssue",
};

const channelFor: Record<JiraMethod, string> = {
  jiraConnect: "drogon:jiraConnect",
  jiraDisconnect: "drogon:jiraDisconnect",
  jiraSelectSite: "drogon:jiraSelectSite",
  jiraStatus: "drogon:jiraStatus",
  jiraTestConnection: "drogon:jiraTestConnection",
  jiraSearchIssues: "drogon:jiraSearchIssues",
  jiraCancelSearchIssues: "drogon:jiraCancelSearchIssues",
  jiraListIssues: "drogon:jiraListIssues",
  jiraListProjects: "drogon:jiraListProjects",
  jiraListIssueTypes: "drogon:jiraListIssueTypes",
  jiraListCreateFields: "drogon:jiraListCreateFields",
  jiraListPriorities: "drogon:jiraListPriorities",
  jiraSearchUsers: "drogon:jiraSearchUsers",
  jiraGetIssue: "drogon:jiraGetIssue",
  jiraComments: "drogon:jiraComments",
  jiraListTransitions: "drogon:jiraListTransitions",
  jiraCreateIssue: "drogon:jiraCreateIssue",
  jiraUpdateIssue: "drogon:jiraUpdateIssue",
  jiraAddComment: "drogon:jiraAddComment",
  jiraStartIssue: "drogon:jiraStartIssue",
};

const invalid = {
  ok: false,
  error: {
    code: "invalid_argument",
    message: "Invalid jira request.",
    retryable: false,
  },
} as const;

const contractMismatch = {
  ok: false,
  error: {
    code: "internal_error",
    message: "The jira response does not match its contract.",
    retryable: false,
  },
} as const;

export async function dispatchJiraRequest(
  method: JiraMethod,
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<unknown>> {
  const parsed = jiraBridgeSchemas[method].safeParse(input);
  if (!parsed.success) return { ...invalid };
  const nativeMethod = nativeMethodFor[method];
  const params = parsed.data === undefined ? {} : (parsed.data as object);
  const result = await call(nativeMethod, params);
  if (!result.ok) return result;
  const schema =
    jiraResultSchemas[nativeMethod as keyof typeof jiraResultSchemas];
  if (!schema) return { ...contractMismatch };
  const checked = schema.safeParse(result.result);
  if (!checked.success) return { ...contractMismatch };
  return { ok: true, result: checked.data };
}

/**
 * Registers one `ipcMain.handle` per jira channel with the same
 * sender/frame gate main/index.ts applies to its own bridge (the pattern
 * tasks-bridge.ts established; bridgeSchemas in shared/bridge-validation.ts
 * is coordinator-owned, so this bridge owns its registration).
 */
export function registerJiraBridge(
  getWindow: () => BrowserWindow | null,
): void {
  for (const method of Object.keys(jiraBridgeSchemas) as JiraMethod[]) {
    ipcMain.handle(channelFor[method], async (event, input: unknown) => {
      const window = getWindow();
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        return { ...invalid };
      return dispatchJiraRequest(method, input);
    });
  }
}
