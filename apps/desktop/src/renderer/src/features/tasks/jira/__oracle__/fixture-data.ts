// R17-C fidelity oracle data: a self-contained snapshot of the committed
// fake-Jira fixture (scripts/fixtures/jira/data/screenshot-site.json),
// narrowed to what the create dialog and issue workspace render. Serving
// it from a module (instead of fetching the fixture) keeps the oracle
// page loadable by a bare vite dev server with no route plugins.
import type {
  JiraComment,
  JiraCreateField,
  JiraIssue,
  JiraIssueType,
  JiraPriority,
  JiraProject,
  JiraTransition,
  JiraUser,
} from "../../../../../../shared/jira-contract";

export const ORACLE_SITE_ID = "site-screenshot-1";

export const ORACLE_PROJECTS: JiraProject[] = [
  { id: "10000", key: "DROG", name: "Drogon", siteId: ORACLE_SITE_ID, siteName: "Acme" },
  { id: "10001", key: "ORCA", name: "Orca Core", siteId: ORACLE_SITE_ID, siteName: "Acme" },
  { id: "10002", key: "MNT", name: "Mentu Runtime", siteId: ORACLE_SITE_ID, siteName: "Acme" },
];

export const ORACLE_ISSUE_TYPES: JiraIssueType[] = [
  { id: "10000", name: "Epic", description: "A big user story", subtask: false },
  { id: "10001", name: "Task", description: "A task", subtask: false },
  { id: "10002", name: "Bug", description: "A bug", subtask: false },
];

// The fixture's required custom fields for the Task type: an option select
// (Team) and a single-user field (Product Owner, a plain Input per the
// fork's dialog).
export const ORACLE_CREATE_FIELDS: JiraCreateField[] = [
  { key: "summary", name: "Summary", required: true, schema: { type: "string" } },
  { key: "issuetype", name: "Issue Type", required: true, schema: { type: "issuetype" } },
  { key: "project", name: "Project", required: true, schema: { type: "project" } },
  { key: "description", name: "Description", required: false, schema: { type: "string" } },
  {
    key: "custom_10002",
    name: "Team",
    required: true,
    schema: { type: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:select" },
    allowedValues: [
      { id: "1", value: "core" },
      { id: "2", value: "desktop" },
      { id: "3", value: "runtime" },
    ],
  },
  { key: "custom_10003", name: "Product Owner", required: true, schema: { type: "user" } },
  {
    key: "assignee",
    name: "Assignee",
    required: false,
    schema: { type: "user" },
    allowedValues: [
      { id: "fixture-user-1", name: "Carlos Fixture" },
      { id: "fixture-user-2", name: "Ana Garcia" },
    ],
  },
];

export const ORACLE_USERS: JiraUser[] = [
  {
    accountId: "fixture-user-1",
    displayName: "Carlos Fixture",
    avatarUrl: "https://www.gravatar.com/avatar/fixture?d=mm&s=48",
  },
  {
    accountId: "fixture-user-2",
    displayName: "Ana Garcia",
    avatarUrl: "https://www.gravatar.com/avatar/fixture2?d=mm&s=48",
  },
];

export const ORACLE_PRIORITIES: JiraPriority[] = [
  { id: "1", name: "Highest" },
  { id: "2", name: "High" },
  { id: "3", name: "Medium" },
  { id: "4", name: "Low" },
];

export const ORACLE_TRANSITIONS: JiraTransition[] = [
  {
    id: "11",
    name: "Start Progress",
    to: { id: "4", name: "In Progress", categoryKey: "indeterminate", categoryName: "In Progress" },
  },
  { id: "21", name: "Done", to: { id: "5", name: "Done", categoryKey: "done", categoryName: "Done" } },
];

// DROG-1 exactly as the fixture serves it (summary, status, assignee,
// priority, labels, ADF description), with the daemon's rendered
// description markdown.
export const ORACLE_ISSUE: JiraIssue = {
  id: "10001",
  key: "DROG-1",
  title: "Project setup and repo bootstrap",
  url: "https://acme.atlassian.net/browse/DROG-1",
  siteId: ORACLE_SITE_ID,
  siteName: "Acme",
  project: { id: "10000", key: "DROG", name: "Drogon" },
  issueType: { id: "10001", name: "Task" },
  status: { id: "3", name: "Backlog", categoryKey: "new", categoryName: "To Do" },
  assignee: ORACLE_USERS[0],
  priority: { id: "2", name: "High" },
  labels: ["setup"],
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-09-01T09:00:00.000Z",
  description: [
    "Bootstrap the repository layout and the first daemon crates.",
    "",
    "- scaffold the workspace",
    "- port the fixture server",
    "",
    "See the migration plan for details.",
  ].join("\n"),
};

export const ORACLE_COMMENTS: JiraComment[] = [
  {
    id: "20001",
    body: "Scaffold is up. Next: port the fixture server and point the tests at it.",
    createdAt: "2026-08-02T09:00:00.000Z",
    user: ORACLE_USERS[1],
  },
  {
    id: "20002",
    body: "The daemon side landed in R17-A; this issue now tracks the rewrite parity pass.",
    createdAt: "2026-08-05T14:30:00.000Z",
    user: ORACLE_USERS[0],
  },
];
