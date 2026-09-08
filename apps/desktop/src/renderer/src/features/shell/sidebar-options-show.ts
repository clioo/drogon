/* MIT Copyright (c) 2026 Lovecast Inc.
   Ported logic from Orca's
   src/renderer/src/components/sidebar/SidebarRepositoryFilterSection.tsx
   (adapter: props instead of the zustand filter store; the visibility
   label and the selected/available split are the source's. Only the
   Projects row of the source's Show section is ported — the MVP has no
   host-scope controls, and Sort by / Project order / card display /
   workspace filters ride sort/group/display stores the MVP lacks; they
   are listed as not-ported in the PR. Pure, unit-tested.) */
import type { Project } from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";

/** Value-side label for the Projects row, exactly like the source: the
   unsettled state reads "All projects", one selection names it, more
   count up. Unknown ids (e.g. lingering after a removal) never inflate
   the count. */
export function getProjectsFilterVisibilityLabel(
  projects: readonly Project[],
  selectedIds: readonly string[],
): string {
  const selected = projects.filter((project) => selectedIds.includes(project.id));
  if (selected.length === 0) return "All projects";
  if (selected.length === 1) return selected[0]?.name ?? "Projects";
  return `${selected.length} projects`;
}

/** Narrows the sidebar to the selected projects. Empty selection means
   no filter — every group stays, like the source's unsettled state. */
export function filterGroupsBySelectedProjects(
  groups: ProjectGroup[],
  selectedIds: readonly string[],
): ProjectGroup[] {
  if (selectedIds.length === 0) return groups;
  const selected = new Set(selectedIds);
  return groups.filter((group) => selected.has(group.project.id));
}
