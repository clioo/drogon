/* MIT Copyright (c) 2026 Lovecast Inc.
   Renderer-local Linear provider (fixture loopback, no network): connection
   state plus the issue collection the Tasks Linear source renders. The
   daemon has no Linear RPC, so acquisition is a locally stored API key and
   issues are seeded fixtures persisted beside it; every read filters that
   local collection, never the wire. */
import type { IssueDetails } from "../../../../../shared/worktree-issue-contract";

export const LINEAR_CONNECTION_STORAGE_KEY = "drogon:linear:connection";
export const LINEAR_ISSUES_STORAGE_KEY = "drogon:linear:issues";
const LINEAR_FIXTURE_ORG = "drogon";

function fixtureIssue(
  identifier: string,
  title: string,
  stateName: string,
  labels: string[] = [],
): IssueDetails {
  return {
    provider: "linear",
    identifier,
    title,
    siteId: null,
    url: `https://linear.app/${LINEAR_FIXTURE_ORG}/issue/${identifier}`,
    stateName,
    labels,
  };
}

/** Deterministic seed: the same three issues on every fresh profile. */
export function linearFixtureIssues(): IssueDetails[] {
  return [
    fixtureIssue("ENG-123", "Linked Linear work", "In Progress", ["backend"]),
    fixtureIssue("ENG-124", "Polish the empty state", "Todo", ["ui"]),
    fixtureIssue("OPS-7", "Rotate the fixture credentials", "Done", []),
  ];
}

export type LinearConnection = { apiKey: string; connectedAt: string };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function memoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

function storage(): StorageLike {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // Private-mode Safari throws on access; fall through to memory.
  }
  return memoryStorage();
}

/** The stored connection, or null when never connected. */
export function readLinearConnection(
  store: StorageLike = storage(),
): LinearConnection | null {
  try {
    const raw = store.getItem(LINEAR_CONNECTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { apiKey?: unknown }).apiKey !== "string" ||
      (parsed as { apiKey: string }).apiKey === ""
    ) {
      return null;
    }
    return parsed as LinearConnection;
  } catch {
    return null;
  }
}

export function isLinearConnected(
  store: StorageLike = storage(),
): boolean {
  return readLinearConnection(store) !== null;
}

/** Acquires the provider: any non-blank key connects and seeds fixtures
 *  once (an existing issue collection is left alone). The key is stored
 *  locally and never sent anywhere — there is no Linear endpoint here. */
export function connectLinear(
  apiKey: string,
  store: StorageLike = storage(),
): LinearConnection | null {
  const key = apiKey.trim();
  if (!key) return null;
  const connection = { apiKey: key, connectedAt: new Date().toISOString() };
  try {
    store.setItem(LINEAR_CONNECTION_STORAGE_KEY, JSON.stringify(connection));
    if (!store.getItem(LINEAR_ISSUES_STORAGE_KEY)) {
      store.setItem(
        LINEAR_ISSUES_STORAGE_KEY,
        JSON.stringify(linearFixtureIssues()),
      );
    }
  } catch {
    return null;
  }
  return connection;
}

export function disconnectLinear(store: StorageLike = storage()): void {
  try {
    store.removeItem(LINEAR_CONNECTION_STORAGE_KEY);
  } catch {
    // Local-only state; a failed clear keeps the in-memory view.
  }
}

/** Creates a fixture issue in the local collection (the Tasks "New"
 *  affordance). The identifier is uppercased; duplicates by identifier
 *  resolve to the existing row. */
export function createLinearFixtureIssue(
  input: { identifier: string; title: string },
  store: StorageLike = storage(),
): IssueDetails | null {
  const identifier = input.identifier.trim().toUpperCase();
  const title = input.title.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(identifier) || !title) return null;
  const issues = readLinearIssues(store);
  const existing = issues.find((issue) => issue.identifier === identifier);
  if (existing) return existing;
  const issue = fixtureIssue(identifier, title, "Todo");
  try {
    store.setItem(LINEAR_ISSUES_STORAGE_KEY, JSON.stringify([...issues, issue]));
  } catch {
    return null;
  }
  return issue;
}

export function readLinearIssues(
  store: StorageLike = storage(),
): IssueDetails[] {
  try {
    const raw = store.getItem(LINEAR_ISSUES_STORAGE_KEY);
    if (!raw) return linearFixtureIssues();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return linearFixtureIssues();
    return (parsed as IssueDetails[]).filter(
      (issue) =>
        typeof issue === "object" &&
        issue !== null &&
        issue.provider === "linear" &&
        typeof issue.identifier === "string",
    );
  } catch {
    return linearFixtureIssues();
  }
}

/** Case-insensitive substring filter over identifier, title and labels. */
export function filterLinearIssues(
  issues: readonly IssueDetails[],
  query: string,
): IssueDetails[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...issues];
  return issues.filter(
    (issue) =>
      issue.identifier.toLowerCase().includes(needle) ||
      issue.title.toLowerCase().includes(needle) ||
      issue.labels.some((label) => label.toLowerCase().includes(needle)),
  );
}
