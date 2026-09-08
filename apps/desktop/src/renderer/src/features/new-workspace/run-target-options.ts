/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/new-workspace/run-target-options.ts and the
   'ready' branch of src/renderer/src/lib/project-host-setup-options.ts.
   Adapter: Drogon has no remote hosts, ephemeral VM recipes or per-host
   project setup — the one run target is the local machine, rendered exactly
   as the fork renders its ready local host (label from
   getLocalExecutionHostLabel, detail = the project path). The source's
   needs-setup / recipes / add-host rows are not ported because their data
   layer does not exist here. */
import type { Project } from "../../../../shared/session-contract";
import { getLocalRunTargetLabel, LOCAL_RUN_TARGET_HOST_ID } from "./host-row-icon";

/** The source's ReadyProjectHostSetupOption shape. */
export type ReadyRunTargetOption = {
  id: string;
  kind: "ready";
  projectId: string;
  hostId: string;
  label: string;
  detail: string;
  path: string;
};

/** A row in the run-target list: local-only, so only ready hosts commit. */
export type RunTargetRowModel = {
  key: string;
  kind: "ready";
  option: ReadyRunTargetOption;
};

/**
 * The single local run target for a selected project — the fork renders the
 * local ready host the same way ("Local Mac" + the project's path).
 */
export function buildLocalRunTargetOption(project: Project): ReadyRunTargetOption {
  return {
    id: `local:${project.id}`,
    kind: "ready",
    projectId: project.id,
    hostId: LOCAL_RUN_TARGET_HOST_ID,
    label: getLocalRunTargetLabel(),
    detail: project.path,
    path: project.path,
  };
}

function matches(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query);
}

/**
 * Filters hosts by a typed query, verbatim from the source's
 * buildRunTargetRows minus the rows whose data layer Drogon does not have
 * (needs-setup hosts, per-workspace recipes, add-host).
 */
export function buildRunTargetRows({
  hostOptions,
  query,
}: {
  hostOptions: readonly ReadyRunTargetOption[];
  query: string;
}): { rows: RunTargetRowModel[] } {
  const trimmed = query.trim().toLowerCase();
  const hostMatches = (option: ReadyRunTargetOption): boolean =>
    trimmed === "" ||
    matches(option.label, trimmed) ||
    matches(option.detail, trimmed) ||
    matches(option.path, trimmed);

  const ready = hostOptions.filter((option) => hostMatches(option));
  const rows: RunTargetRowModel[] = ready.map((option) => ({
    key: `host:${option.id}`,
    kind: "ready" as const,
    option,
  }));
  return { rows };
}
