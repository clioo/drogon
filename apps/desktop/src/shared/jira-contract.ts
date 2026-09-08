// Jira data-layer contract (R17-A): the desktop bridge for the daemon's
// `jira.*` RPCs, ported from the orca-drogon fork's Jira surface
// (`src/shared/jira-types.ts`, `src/main/ipc/jira.ts`). Shapes mirror the
// serde camelCase JSON projections of `crates/drogon-protocol/src/jira.rs`.
// This is the Tasks page's (R17-B) and create dialog's (R17-C) consumption
// contract — nothing here invents data the daemon did not return.

import { z } from "zod";
import type { Result } from "./session-contract";

export const JIRA_CAPABILITY = "jira.v1";

export type JiraAuthType = "cloud" | "server";

export type JiraSite = {
  id: string;
  siteUrl: string;
  email: string;
  displayName: string;
  accountId: string;
  authType: JiraAuthType;
};

export type JiraViewer = {
  accountId: string;
  displayName: string;
  email: string | null;
  avatarUrl?: string;
};

export type JiraConnectionStatus = {
  connected: boolean;
  viewer: JiraViewer | null;
  sites: JiraSite[];
  activeSiteId: string | null;
  selectedSiteId: string | null;
  /** Set when a stored token file exists but could not be decrypted. */
  credentialError?: string;
};

export type JiraProject = {
  id: string;
  key: string;
  name: string;
  siteId?: string;
  siteName?: string;
};

export type JiraIssueType = {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  subtask?: boolean;
};

export type JiraCreateFieldAllowedValue = {
  id?: string;
  value?: string;
  name?: string;
};

export type JiraCreateField = {
  key: string;
  name: string;
  required: boolean;
  schema?: {
    type?: string;
    items?: string;
    custom?: string;
  };
  allowedValues?: JiraCreateFieldAllowedValue[];
};

export type JiraUser = {
  accountId: string;
  displayName: string;
  email?: string | null;
  avatarUrl?: string;
};

export type JiraPriority = {
  id: string;
  name: string;
  iconUrl?: string;
};

export type JiraStatus = {
  id: string;
  name: string;
  categoryKey: string;
  categoryName: string;
  colorName?: string;
};

/** The fork's four Tasks-page filter tabs. */
export type JiraIssueFilter = "assigned" | "reported" | "all" | "done";

export type JiraIssue = {
  id: string;
  key: string;
  siteId?: string;
  siteName?: string;
  title: string;
  url: string;
  project: JiraProject;
  issueType: JiraIssueType;
  status: JiraStatus;
  labels: string[];
  assignee?: JiraUser;
  reporter?: JiraUser;
  priority?: JiraPriority;
  updatedAt: string;
  createdAt: string;
};

/**
 * Search/list result. The fork's renderer boundary returns a bare issue
 * array; Drogon adds `total`/`isLast` additively so the list can render
 * the "N shown" counter and page without a second call.
 */
export type JiraSearchResult = {
  issues: JiraIssue[];
  total?: number;
  isLast?: boolean;
};

export type JiraConnectResult = { ok: true; viewer: JiraViewer };

export interface JiraBridge {
  /**
   * `siteUrl` + `email` + `apiToken` are validated against `/rest/api/3/myself`
   * (`/rest/api/2/myself` for `authType: "server"`), the site is stored in
   * the daemon data dir, and the identity comes back. Failures ride the
   * `Result` error envelope (`jira_auth_required`, `jira_unreachable`, ...).
   */
  jiraConnect(input: {
    siteUrl: string;
    email?: string;
    apiToken: string;
    authType?: JiraAuthType;
  }): Promise<Result<JiraConnectResult>>;
  /** Without a siteId every connected site is disconnected. */
  jiraDisconnect(input: { siteId?: string }): Promise<Result<unknown>>;
  /** `"all"` or a site id from `jira.status.sites`. */
  jiraSelectSite(input: {
    siteId: string;
  }): Promise<Result<JiraConnectionStatus>>;
  jiraStatus(): Promise<Result<JiraConnectionStatus>>;
  /** Re-validates the saved credential against `/myself` (the fork's testConnection). */
  jiraTestConnection(input: {
    siteId?: string;
  }): Promise<Result<JiraViewer>>;
  /**
   * Runs `jql` verbatim. `requestId` is the cancellation key: re-using it
   * abandons the previous search with that id, and
   * `jiraCancelSearchIssues` kills a live one — the fork aborts a search
   * when the query changes.
   */
  jiraSearchIssues(input: {
    jql: string;
    limit?: number;
    startAt?: number;
    siteId?: string;
    requestId?: string;
  }): Promise<Result<JiraSearchResult>>;
  jiraCancelSearchIssues(input: {
    requestId?: string;
  }): Promise<Result<{ cancelled: boolean }>>;
  jiraListIssues(input: {
    filter?: JiraIssueFilter;
    limit?: number;
    siteId?: string;
    requestId?: string;
  }): Promise<Result<JiraSearchResult>>;
  /** Paged project picker data, locale-sorted by name. */
  jiraListProjects(input: {
    siteId?: string;
  }): Promise<Result<JiraProject[]>>;
  jiraListIssueTypes(input: {
    projectIdOrKey: string;
    siteId?: string;
  }): Promise<Result<JiraIssueType[]>>;
  jiraListCreateFields(input: {
    projectIdOrKey: string;
    issueTypeId: string;
    siteId?: string;
  }): Promise<Result<JiraCreateField[]>>;
  jiraListPriorities(input: { siteId?: string }): Promise<Result<JiraPriority[]>>;
  jiraSearchUsers(input: {
    query?: string;
    siteId?: string;
  }): Promise<Result<JiraUser[]>>;
}

// --- zod validation --------------------------------------------------------

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\s\x00-\x1f\x7f]+$/u);

const siteSelection = z.string().min(1).max(256).optional();

const authType = z.enum(["cloud", "server"]).optional();

const viewerSchema = z.object({
  accountId: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  avatarUrl: z.string().optional(),
});

const siteSchema = z.object({
  id: z.string(),
  siteUrl: z.string(),
  email: z.string(),
  displayName: z.string(),
  accountId: z.string(),
  authType: z.enum(["cloud", "server"]),
});

export const jiraBridgeSchemas = {
  jiraConnect: z.object({
    siteUrl: z.string().min(1).max(2048),
    email: z.string().max(320).optional(),
    apiToken: z.string().min(1).max(4096),
    authType,
  }),
  jiraDisconnect: z.object({ siteId: id.optional() }),
  jiraSelectSite: z.object({ siteId: z.string().min(1).max(256) }),
  jiraStatus: z.undefined(),
  jiraTestConnection: z.object({ siteId: id.optional() }),
  jiraSearchIssues: z.object({
    jql: z.string().trim().min(1).max(4096),
    limit: z.number().int().min(0).max(100).optional(),
    startAt: z.number().int().min(0).optional(),
    siteId: siteSelection,
    requestId: id.optional(),
  }),
  jiraCancelSearchIssues: z.object({ requestId: id.optional() }),
  jiraListIssues: z.object({
    filter: z.enum(["assigned", "reported", "all", "done"]).optional(),
    limit: z.number().int().min(0).max(100).optional(),
    siteId: siteSelection,
    requestId: id.optional(),
  }),
  jiraListProjects: z.object({ siteId: siteSelection }),
  jiraListIssueTypes: z.object({
    projectIdOrKey: z.string().min(1).max(128),
    siteId: siteSelection,
  }),
  jiraListCreateFields: z.object({
    projectIdOrKey: z.string().min(1).max(128),
    issueTypeId: z.string().min(1).max(128),
    siteId: siteSelection,
  }),
  jiraListPriorities: z.object({ siteId: siteSelection }),
  jiraSearchUsers: z.object({
    query: z.string().max(256).optional(),
    siteId: siteSelection,
  }),
};

const statusSchema: z.ZodType<JiraConnectionStatus> = z.object({
  connected: z.boolean(),
  viewer: viewerSchema.nullable(),
  sites: z.array(siteSchema),
  activeSiteId: z.string().nullable(),
  selectedSiteId: z.string().nullable(),
  credentialError: z.string().optional(),
});

const projectSchema: z.ZodType<JiraProject> = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  siteId: z.string().optional(),
  siteName: z.string().optional(),
});

const issueTypeSchema: z.ZodType<JiraIssueType> = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  iconUrl: z.string().optional(),
  subtask: z.boolean().optional(),
});

const createFieldSchema: z.ZodType<JiraCreateField> = z.object({
  key: z.string(),
  name: z.string(),
  required: z.boolean(),
  schema: z
    .object({
      type: z.string().optional(),
      items: z.string().optional(),
      custom: z.string().optional(),
    })
    .optional(),
  allowedValues: z
    .array(
      z.object({
        id: z.string().optional(),
        value: z.string().optional(),
        name: z.string().optional(),
      }),
    )
    .optional(),
});

const userSchema: z.ZodType<JiraUser> = z.object({
  accountId: z.string(),
  displayName: z.string(),
  email: z.string().nullable().optional(),
  avatarUrl: z.string().optional(),
});

const prioritySchema: z.ZodType<JiraPriority> = z.object({
  id: z.string(),
  name: z.string(),
  iconUrl: z.string().optional(),
});

const issueSchema: z.ZodType<JiraIssue> = z.object({
  id: z.string(),
  key: z.string(),
  siteId: z.string().optional(),
  siteName: z.string().optional(),
  title: z.string(),
  url: z.string(),
  project: projectSchema,
  issueType: issueTypeSchema,
  status: z.object({
    id: z.string(),
    name: z.string(),
    categoryKey: z.string(),
    categoryName: z.string(),
    colorName: z.string().optional(),
  }),
  labels: z.array(z.string()),
  assignee: userSchema.optional(),
  reporter: userSchema.optional(),
  priority: prioritySchema.optional(),
  updatedAt: z.string(),
  createdAt: z.string(),
});

const searchResultSchema: z.ZodType<JiraSearchResult> = z.object({
  issues: z.array(issueSchema),
  total: z.number().int().nonnegative().optional(),
  isLast: z.boolean().optional(),
});

/**
 * Result schemas per native method, registered into the shared
 * `resultSchemas` map by main/jira-bridge.ts at module load (the same
 * granted-file pattern as tasks-contract.ts, so native-client's
 * `resultSchemas[method]` lookup stays exact without touching the
 * coordinator-owned result-validation.ts).
 */
export const jiraResultSchemas = {
  "jira.connect": z.object({ ok: z.literal(true), viewer: viewerSchema }),
  "jira.disconnect": z.unknown(),
  "jira.selectSite": statusSchema,
  "jira.status": statusSchema,
  "jira.testConnection": viewerSchema,
  "jira.searchIssues": searchResultSchema,
  "jira.cancelSearchIssues": z.object({ cancelled: z.boolean() }),
  "jira.listIssues": searchResultSchema,
  "jira.listProjects": z.array(projectSchema),
  "jira.listIssueTypes": z.array(issueTypeSchema),
  "jira.listCreateFields": z.array(createFieldSchema),
  "jira.listPriorities": z.array(prioritySchema),
  "jira.searchUsers": z.array(userSchema),
} satisfies Record<string, z.ZodType>;
