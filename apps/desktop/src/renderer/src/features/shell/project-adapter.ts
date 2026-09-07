import type {
  AgentState,
  Project,
  Result,
  Session,
  Worktree,
  Workspace,
} from "../../../../shared/session-contract";

/**
 * Capability markers for the project/worktree RPCs (journey J1). Kept
 * module-local — shared/session-contract.ts declares the shapes but no
 * capability ids (coordinator-owned) — mirroring the BOTS_CAPABILITY
 * pattern in bots-mount.ts. Values match crates/drogon-protocol
 * PROJECT_CAPABILITY / WORKTREE_CAPABILITY.
 */
export const PROJECT_CAPABILITY = "project.v1";
export const WORKTREE_CAPABILITY = "worktree.v1";

/** True exactly when the live service advertises project RPCs. */
export function isProjectsAvailable(capabilities: readonly string[]): boolean {
  return capabilities.includes(PROJECT_CAPABILITY);
}

/** True exactly when the live service advertises worktree RPCs. */
export function isWorktreesAvailable(capabilities: readonly string[]): boolean {
  return capabilities.includes(WORKTREE_CAPABILITY);
}

/**
 * Structural subset of the daemon bridge the R1-S worker is adding
 * (`project.list`, `worktree.list`, `project.add`, `worktree.create`).
 * Every method is optional: App passes `window.drogon` widened to this
 * type and the loader below only calls what exists while the matching
 * capability is advertised.
 */
export interface ProjectRpcBridge {
  projectList?: () => Promise<Result<{ projects: Project[] }>>;
  worktreeList?: (input: {
    projectId?: string;
  }) => Promise<Result<{ worktrees: Worktree[] }>>;
  projectAdd?: (input: {
    path: string;
    name?: string;
  }) => Promise<Result<Project>>;
}

/** One project with the worktrees that belong to it, in list order. */
export interface ProjectGroup {
  project: Project;
  worktrees: Worktree[];
}

/**
 * Projects the existing Workspace list as one folder project per
 * workspace with one implicit worktree (the folder itself), so the
 * sidebar renders real data before the daemon advertises project.v1.
 * The implicit worktree keeps the workspace id as its workspaceId, so
 * selecting its card selects that workspace; branch is empty because a
 * plain folder has none and the card hides the branch row then.
 */
export function projectWorkspacesAsFolderProjects(
  workspaces: Workspace[],
): ProjectGroup[] {
  return workspaces.map((workspace) => {
    const project: Project = {
      id: `folder:${workspace.id}`,
      hostId: workspace.hostId,
      path: workspace.path,
      name: workspace.name,
      kind: "folder",
      defaultBaseRef: null,
    };
    const worktree: Worktree = {
      id: `implicit:${workspace.id}`,
      projectId: project.id,
      workspaceId: workspace.id,
      path: workspace.path,
      branch: "",
      head: "",
      baseRef: null,
      createdAt: "",
    };
    return { project, worktrees: [worktree] };
  });
}

/**
 * Groups advertised projects with their worktrees. Worktrees whose
 * projectId matches no listed project are dropped — rendering a card
 * that cannot resolve its project header would be inventing structure.
 */
export function groupProjectWorktrees(
  projects: Project[],
  worktrees: Worktree[],
): ProjectGroup[] {
  const byProject = new Map<string, Worktree[]>();
  for (const worktree of worktrees) {
    const list = byProject.get(worktree.projectId);
    if (list) list.push(worktree);
    else byProject.set(worktree.projectId, [worktree]);
  }
  return projects.map((project) => ({
    project,
    worktrees: byProject.get(project.id) ?? [],
  }));
}

/**
 * Loads the sidebar view: real projects/worktrees when the service
 * advertises both capabilities and implements the RPCs, otherwise the
 * workspace projection above. An RPC failure also falls back to the
 * projection — the Workspace list is already confirmed real data, and
 * an empty sidebar on a transient list failure would hide it.
 */
export async function loadProjectView(
  bridge: ProjectRpcBridge,
  capabilities: readonly string[],
  workspaces: Workspace[],
): Promise<{ groups: ProjectGroup[]; source: "rpc" | "workspace-fallback" }> {
  if (
    isProjectsAvailable(capabilities) &&
    isWorktreesAvailable(capabilities) &&
    typeof bridge.projectList === "function" &&
    typeof bridge.worktreeList === "function"
  ) {
    try {
      const listed = await bridge.projectList();
      if (listed.ok) {
        const trees = await bridge.worktreeList({});
        if (trees.ok)
          return {
            groups: groupProjectWorktrees(
              listed.result.projects,
              trees.result.worktrees,
            ),
            source: "rpc",
          };
      }
    } catch {
      // Fall through to the workspace projection below.
    }
  }
  return {
    groups: projectWorkspacesAsFolderProjects(workspaces),
    source: "workspace-fallback",
  };
}

/** Filters groups/cards by project, branch or display name (case-insensitive). Pure so the list stays a thin view. */
export function filterProjectGroups(
  groups: ProjectGroup[],
  workspaces: Workspace[],
  query: string,
): ProjectGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  const cardMatches = (group: ProjectGroup, worktree: Worktree) =>
    group.project.name.toLowerCase().includes(needle) ||
    worktree.branch.toLowerCase().includes(needle) ||
    worktreeDisplayName(worktree, workspaces).toLowerCase().includes(needle);
  return groups
    .map((group) => ({
      ...group,
      worktrees: group.worktrees.filter((worktree) =>
        cardMatches(group, worktree),
      ),
    }))
    .filter(
      (group) =>
        group.worktrees.length > 0 ||
        group.project.name.toLowerCase().includes(needle),
    );
}

/** Display name for a worktree card: its workspace name, else branch, else short id. */
export function worktreeDisplayName(
  worktree: Worktree,
  workspaces: Workspace[],
): string {
  const workspace = workspaces.find((item) => item.id === worktree.workspaceId);
  if (workspace) return workspace.name;
  if (worktree.branch) return worktree.branch;
  return worktree.id.slice(0, 8);
}

/**
 * Relative activity stamp for a card (`agentStateAt` ISO, `nowMs`
 * injectable for tests). Empty string when there is nothing to show —
 * the card hides the stamp instead of inventing one.
 */
export function relativeActivityTime(
  at: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!at) return "";
  const then = Date.parse(at);
  if (Number.isNaN(then)) return "";
  const deltaMs = nowMs - then;
  if (deltaMs < 0) return "";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (deltaMs < minute) return "just now";
  if (deltaMs < hour) return `${Math.floor(deltaMs / minute)}m ago`;
  if (deltaMs < day) return `${Math.floor(deltaMs / hour)}h ago`;
  if (deltaMs < 30 * day) return `${Math.floor(deltaMs / day)}d ago`;
  return new Date(then).toLocaleDateString();
}

/**
 * Issue links for worktree cards (journey J6). The Tasks page refreshes
 * this store from `tasks.links`; cards read it synchronously so no
 * Sidebar/ProjectList plumbing has to change. Empty by default — a card
 * without a link shows no badge instead of inventing one.
 */
export type WorktreeIssueLink = {
  worktreeId: string;
  issueNumber: number;
};

let worktreeIssueLinks: ReadonlyMap<string, number> = new Map();
const worktreeIssueLinkListeners = new Set<() => void>();

/** Replaces the whole link set (one refresh owns the full picture). */
export function setWorktreeIssueLinks(links: WorktreeIssueLink[]): void {
  const next = new Map<string, number>();
  for (const link of links) {
    if (link.worktreeId && Number.isInteger(link.issueNumber)) {
      next.set(link.worktreeId, link.issueNumber);
    }
  }
  worktreeIssueLinks = next;
  for (const listener of worktreeIssueLinkListeners) listener();
}

/** The linked issue number for one worktree, or null when unlinked. */
export function getWorktreeIssueNumber(worktreeId: string): number | null {
  return worktreeIssueLinks.get(worktreeId) ?? null;
}

/** Subscribes to link refreshes; returns the unsubscribe function. */
export function subscribeWorktreeIssueLinks(listener: () => void): () => void {
  worktreeIssueLinkListeners.add(listener);
  return () => {
    worktreeIssueLinkListeners.delete(listener);
  };
}

export type CardAgentSummary = {
  /** Rendered agent state; never invented — `unknown` when unreported. */
  state: AgentState;
  /** True when any attached session needs input (the unread marker). */
  unread: boolean;
  /** Relative stamp of the freshest attached report, or "". */
  activeRelative: string;
};

/**
 * Summarizes the sessions attached to one worktree card. The freshest
 * report by agentStateAt wins; sessions without a stamp sort last and
 * ties break toward needs_input so attention is never hidden. No
 * session (or no stamp anywhere) yields `unknown` with an empty stamp.
 */
export function summarizeCardSessions(
  sessions: Session[],
  nowMs: number = Date.now(),
): CardAgentSummary {
  const ranked = [...sessions].sort((a, b) => {
    const aAt = a.agentStateAt ? Date.parse(a.agentStateAt) : NaN;
    const bAt = b.agentStateAt ? Date.parse(b.agentStateAt) : NaN;
    const aTime = Number.isNaN(aAt) ? -1 : aAt;
    const bTime = Number.isNaN(bAt) ? -1 : bAt;
    if (aTime !== bTime) return bTime - aTime;
    const rank = (state: AgentState | undefined) =>
      state === "needs_input" ? 0 : 1;
    return rank(a.agentState) - rank(b.agentState);
  });
  const freshest = ranked[0];
  const unread = sessions.some(
    (session) => (session.agentState ?? "unknown") === "needs_input",
  );
  return {
    state: freshest?.agentState ?? "unknown",
    unread,
    activeRelative: relativeActivityTime(
      freshest?.agentStateAt ?? null,
      nowMs,
    ),
  };
}
