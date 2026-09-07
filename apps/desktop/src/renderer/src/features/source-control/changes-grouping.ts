import type { GitStatusEntry } from "../../../../shared/git-contract";

export type ChangeGroup = "staged" | "unstaged" | "untracked";

/**
 * Groups one status entry for the Changes panel. An entry with both staged
 * and unstaged modifications ("MM") appears in both groups, matching Git
 * clients; untracked paths group alone; ignored paths never render.
 * Unmerged conflicts always group as unstaged — staging never resolves
 * them, so showing them as staged would lie about readiness to commit.
 */
export function groupsFor(entry: GitStatusEntry): ChangeGroup[] {
  if (entry.kind === "untracked") return ["untracked"];
  if (entry.kind === "ignored") return [];
  if (entry.kind === "unmerged") return ["unstaged"];
  const groups: ChangeGroup[] = [];
  if (entry.staged !== "." && entry.staged !== " ") groups.push("staged");
  if (entry.unstaged !== "." && entry.unstaged !== " ") groups.push("unstaged");
  // No marker on either side (e.g. a typechange the codes don't flag):
  // the path came from status, so it changed somewhere — show it unstaged
  // rather than dropping it.
  if (groups.length === 0) groups.push("unstaged");
  return groups;
}

/** Short badge letter for a group, in the entry's own marker when present. */
export function badgeFor(entry: GitStatusEntry, group: ChangeGroup): string {
  if (entry.kind === "untracked") return "?";
  if (group === "staged") return entry.staged === "." ? "M" : entry.staged;
  if (entry.kind === "rename") return "R";
  if (entry.kind === "copy") return "C";
  if (entry.kind === "unmerged") return "U";
  return entry.unstaged === "." ? "M" : entry.unstaged;
}

/** Grouped view model; order within a group is status order (stable). */
export type GroupedChanges = Record<ChangeGroup, GitStatusEntry[]>;

export function groupChanges(entries: readonly GitStatusEntry[]): GroupedChanges {
  const grouped: GroupedChanges = { staged: [], unstaged: [], untracked: [] };
  for (const entry of entries) {
    for (const group of groupsFor(entry)) grouped[group].push(entry);
  }
  return grouped;
}

/** Whether anything is staged and a commit can run. */
export function canCommit(entries: readonly GitStatusEntry[]): boolean {
  return entries.some((entry) => groupsFor(entry).includes("staged"));
}

/** Status entries that a push/PR could publish: staged or unstaged work. */
export function hasLocalChanges(entries: readonly GitStatusEntry[]): boolean {
  return entries.some((entry) => groupsFor(entry).length > 0);
}
