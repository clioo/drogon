/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca
   src/shared/workspace-statuses.ts, src/shared/workspace-status-defaults.ts and
   src/renderer/src/components/sidebar/workspace-status.ts (visual-meta half) at
   pinned source c9790628 (clioo/drogon-orca). Adaptations, data layer only:
   i18n translate(id, fallback) collapsed to English fallback strings and
   createLocalizedCatalog replaced by a plain factory; the source re-export
   surface is flattened into one module. Column identities, labels, colors,
   icons and the width clamp contract are the source's, unchanged. */
import { CircleDot } from "lucide-react";
import {
  getWorkspaceStatusIconOptions,
  type WorkspaceStatusIconOption,
} from "./workspace-status-icon-options";

export { getWorkspaceStatusIconOptions };
export type { WorkspaceStatusIconOption } from "./workspace-status-icon-options";

export type WorkspaceStatus = string;

export type WorkspaceStatusDefinition = {
  id: WorkspaceStatus;
  label: string;
  color?: string;
  icon?: string;
};

export const DEFAULT_STATUS_VISUALS: Record<
  string,
  { color: string; icon: string }
> = {
  todo: { color: "neutral", icon: "circle" },
  "in-progress": { color: "conductor-progress", icon: "conductor-progress" },
  "in-review": { color: "conductor-review", icon: "conductor-review" },
  completed: { color: "conductor-done", icon: "conductor-done" },
};

export const DEFAULT_WORKSPACE_STATUSES = [
  { id: "todo", label: "Todo", color: "neutral", icon: "circle" },
  {
    id: "in-progress",
    label: "In progress",
    color: "conductor-progress",
    icon: "conductor-progress",
  },
  {
    id: "in-review",
    label: "In review",
    color: "conductor-review",
    icon: "conductor-review",
  },
  {
    id: "completed",
    label: "Done",
    color: "conductor-done",
    icon: "conductor-done",
  },
] as const satisfies readonly WorkspaceStatusDefinition[];

const WORKSPACE_STATUS_GROUP_PREFIX = "workspace-status:";
const MAX_STATUS_LABEL_LENGTH = 32;

export const DEFAULT_WORKSPACE_STATUS_ID: WorkspaceStatus = "in-progress";
export const DEFAULT_WORKSPACE_STATUS_COLOR_ID = "neutral";
export const DEFAULT_WORKSPACE_STATUS_ICON_ID = "circle-dot";
export const WORKSPACE_BOARD_COLUMN_WIDTH_DEFAULT = 308;
export const WORKSPACE_BOARD_COLUMN_WIDTH_MIN = 220;
export const WORKSPACE_BOARD_COLUMN_WIDTH_MAX = 520;
export const WORKSPACE_BOARD_COLUMN_WIDTH_STEP = 20;

export const WORKSPACE_STATUS_COLOR_IDS = [
  "neutral",
  "blue",
  "sky",
  "violet",
  "amber",
  "emerald",
  "rose",
  "zinc",
  "conductor-done",
  "conductor-review",
  "conductor-progress",
] as const;

export const WORKSPACE_STATUS_ICON_IDS = [
  "circle",
  "circle-dot",
  "circle-progress",
  "circle-dashed",
  "circle-ellipsis",
  "git-pull-request",
  "timer",
  "flag",
  "circle-alert",
  "circle-pause",
  "circle-play",
  "circle-check",
  "ban",
  "conductor-done",
  "conductor-review",
  "conductor-progress",
] as const;

export function cloneDefaultWorkspaceStatuses(): WorkspaceStatusDefinition[] {
  return DEFAULT_WORKSPACE_STATUSES.map((status) => ({ ...status }));
}

function sanitizeWorkspaceStatusLabel(
  value: unknown,
  fallback: string,
): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, MAX_STATUS_LABEL_LENGTH) : fallback;
}

function slugWorkspaceStatusLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "status";
}

function sanitizeWorkspaceStatusId(
  value: unknown,
  fallbackLabel: string,
): WorkspaceStatus {
  if (typeof value !== "string") {
    return slugWorkspaceStatusLabel(fallbackLabel);
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return slugWorkspaceStatusLabel(fallbackLabel);
  }
  return (
    trimmed.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "status"
  );
}

function sanitizeWorkspaceStatusColor(
  value: unknown,
  statusId: string,
  index: number,
): string {
  if (
    typeof value === "string" &&
    WORKSPACE_STATUS_COLOR_IDS.some((id) => id === value)
  ) {
    return value;
  }
  const defaultVisual = DEFAULT_STATUS_VISUALS[statusId];
  if (defaultVisual) {
    return defaultVisual.color;
  }
  return WORKSPACE_STATUS_COLOR_IDS[index % WORKSPACE_STATUS_COLOR_IDS.length];
}

function sanitizeWorkspaceStatusIcon(value: unknown, statusId: string): string {
  if (
    typeof value === "string" &&
    WORKSPACE_STATUS_ICON_IDS.some((id) => id === value)
  ) {
    return value;
  }
  return (
    DEFAULT_STATUS_VISUALS[statusId]?.icon ?? DEFAULT_WORKSPACE_STATUS_ICON_ID
  );
}

export function makeWorkspaceStatusId(
  label: string,
  existingStatuses: readonly WorkspaceStatusDefinition[],
): WorkspaceStatus {
  const base = slugWorkspaceStatusLabel(label);
  const existingIds = new Set(existingStatuses.map((status) => status.id));
  if (!existingIds.has(base)) {
    return base;
  }
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }
  return `status-${Date.now().toString(36)}`;
}

export function normalizeWorkspaceStatuses(
  value: unknown,
): WorkspaceStatusDefinition[] {
  if (!Array.isArray(value)) {
    return cloneDefaultWorkspaceStatuses();
  }

  const statuses: WorkspaceStatusDefinition[] = [];
  const usedIds = new Set<string>();
  for (const rawStatus of value) {
    if (
      !rawStatus ||
      typeof rawStatus !== "object" ||
      Array.isArray(rawStatus)
    ) {
      continue;
    }
    const raw = rawStatus as Record<string, unknown>;
    const fallbackLabel = `Status ${statuses.length + 1}`;
    const label = sanitizeWorkspaceStatusLabel(raw.label, fallbackLabel);
    let id = sanitizeWorkspaceStatusId(raw.id, label);
    if (usedIds.has(id)) {
      id = makeWorkspaceStatusId(label, statuses);
    }
    usedIds.add(id);
    statuses.push({
      id,
      label,
      color: sanitizeWorkspaceStatusColor(raw.color, id, statuses.length),
      icon: sanitizeWorkspaceStatusIcon(raw.icon, id),
    });
  }

  if (statuses.length === 0) {
    return cloneDefaultWorkspaceStatuses();
  }

  return statuses;
}

export function clampWorkspaceBoardOpacity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0.2, Math.round(value * 100) / 100));
}

export function clampWorkspaceBoardColumnWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return WORKSPACE_BOARD_COLUMN_WIDTH_DEFAULT;
  }
  return Math.min(
    WORKSPACE_BOARD_COLUMN_WIDTH_MAX,
    Math.max(WORKSPACE_BOARD_COLUMN_WIDTH_MIN, Math.round(value)),
  );
}

export function isWorkspaceStatusId(
  value: string,
  statuses: readonly WorkspaceStatusDefinition[],
): value is WorkspaceStatus {
  return statuses.some((status) => status.id === value);
}

export function getDefaultWorkspaceStatusId(
  statuses: readonly WorkspaceStatusDefinition[],
): WorkspaceStatus {
  return statuses.some((status) => status.id === DEFAULT_WORKSPACE_STATUS_ID)
    ? DEFAULT_WORKSPACE_STATUS_ID
    : (statuses[0]?.id ?? DEFAULT_WORKSPACE_STATUS_ID);
}

export function getWorkspaceStatus(
  worktree: { workspaceStatus?: string | null },
  statuses: readonly WorkspaceStatusDefinition[],
): WorkspaceStatus {
  // Structural read: the adapter row (KanbanWorktree) always carries the field.
  return worktree.workspaceStatus &&
    isWorkspaceStatusId(worktree.workspaceStatus, statuses)
    ? worktree.workspaceStatus
    : getDefaultWorkspaceStatusId(statuses);
}

export function getWorkspaceStatusGroupKey(status: WorkspaceStatus): string {
  return `${WORKSPACE_STATUS_GROUP_PREFIX}${encodeURIComponent(status)}`;
}

export function getWorkspaceStatusFromGroupKey(
  groupKey: string,
  statuses: readonly WorkspaceStatusDefinition[],
): WorkspaceStatus | null {
  if (!groupKey.startsWith(WORKSPACE_STATUS_GROUP_PREFIX)) {
    return null;
  }
  try {
    const status = decodeURIComponent(
      groupKey.slice(WORKSPACE_STATUS_GROUP_PREFIX.length),
    );
    return isWorkspaceStatusId(status, statuses) ? status : null;
  } catch {
    return null;
  }
}

type WorkspaceStatusColorOption = {
  id: string;
  label: string;
  tone: string;
  swatch: string;
  border: string;
  laneTint: string;
};

export const getWorkspaceStatusColorOptions =
  (): WorkspaceStatusColorOption[] => [
    {
      id: "neutral",
      label: "Neutral",
      tone: "text-muted-foreground",
      swatch: "bg-muted-foreground",
      border: "border-t-muted-foreground/45",
      laneTint: "bg-background/55",
    },
    {
      id: "blue",
      label: "Blue",
      tone: "text-blue-600 dark:text-blue-300",
      swatch: "bg-blue-500",
      border: "border-t-blue-500/70",
      laneTint: "bg-blue-500/[0.04]",
    },
    {
      id: "sky",
      label: "Sky",
      tone: "text-sky-600 dark:text-sky-300",
      swatch: "bg-sky-500",
      border: "border-t-sky-500/70",
      laneTint: "bg-sky-500/[0.04]",
    },
    {
      id: "violet",
      label: "Violet",
      tone: "text-violet-600 dark:text-violet-300",
      swatch: "bg-violet-500",
      border: "border-t-violet-500/70",
      laneTint: "bg-violet-500/[0.04]",
    },
    {
      id: "amber",
      label: "Amber",
      tone: "text-amber-700 dark:text-amber-200",
      swatch: "bg-amber-500",
      border: "border-t-amber-500/70",
      laneTint: "bg-amber-500/[0.04]",
    },
    {
      id: "emerald",
      label: "Emerald",
      tone: "text-emerald-700 dark:text-emerald-200",
      swatch: "bg-emerald-500",
      border: "border-t-emerald-500/70",
      laneTint: "bg-emerald-500/[0.04]",
    },
    {
      id: "rose",
      label: "Rose",
      tone: "text-rose-600 dark:text-rose-300",
      swatch: "bg-rose-500",
      border: "border-t-rose-500/70",
      laneTint: "bg-rose-500/[0.04]",
    },
    {
      id: "zinc",
      label: "Zinc",
      tone: "text-zinc-600 dark:text-zinc-300",
      swatch: "bg-zinc-500",
      border: "border-t-zinc-500/70",
      laneTint: "bg-zinc-500/[0.04]",
    },
    {
      id: "conductor-done",
      label: "Conductor Done",
      tone: "text-[#c7a594]",
      swatch: "bg-[#c7a594]",
      border: "border-t-[#c7a594]/70",
      laneTint: "bg-[#c7a594]/[0.04]",
    },
    {
      id: "conductor-review",
      label: "Conductor Review",
      tone: "text-[#16a34a]",
      swatch: "bg-[#16a34a]",
      border: "border-t-[#16a34a]/70",
      laneTint: "bg-[#16a34a]/[0.04]",
    },
    {
      id: "conductor-progress",
      label: "Conductor Progress",
      tone: "text-[#d4a300]",
      swatch: "bg-[#d4a300]",
      border: "border-t-[#d4a300]/70",
      laneTint: "bg-[#d4a300]/[0.04]",
    },
  ];

function getFallbackColorOption(): WorkspaceStatusColorOption {
  return (
    getWorkspaceStatusColorOptions()[0] ?? {
      id: DEFAULT_WORKSPACE_STATUS_COLOR_ID,
      label: "Neutral",
      tone: "text-muted-foreground",
      swatch: "bg-muted-foreground",
      border: "border-t-muted-foreground/45",
      laneTint: "bg-background/55",
    }
  );
}

function getFallbackIconOption(): WorkspaceStatusIconOption {
  return (
    getWorkspaceStatusIconOptions()[1] ?? {
      id: DEFAULT_WORKSPACE_STATUS_ICON_ID,
      label: "Dot",
      icon: CircleDot,
    }
  );
}

export function getWorkspaceStatusVisualMeta(
  status: WorkspaceStatus | WorkspaceStatusDefinition,
): {
  tone: string;
  swatch: string;
  border: string;
  laneTint: string;
  icon: React.ComponentType<{ className?: string }>;
} {
  const statusId = typeof status === "string" ? status : status.id;
  const visual =
    typeof status === "string" ? DEFAULT_STATUS_VISUALS[status] : status;
  const colorId = visual?.color ?? DEFAULT_STATUS_VISUALS[statusId]?.color;
  const iconId = visual?.icon ?? DEFAULT_STATUS_VISUALS[statusId]?.icon;
  const color =
    getWorkspaceStatusColorOptions().find((option) => option.id === colorId) ??
    getWorkspaceStatusColorOptions().find(
      (option) => option.id === DEFAULT_WORKSPACE_STATUS_COLOR_ID,
    ) ??
    getFallbackColorOption();
  const iconOptions = getWorkspaceStatusIconOptions();
  const icon =
    iconOptions.find((option) => option.id === iconId) ??
    iconOptions.find(
      (option) => option.id === DEFAULT_WORKSPACE_STATUS_ICON_ID,
    ) ??
    getFallbackIconOption();

  return {
    tone: color.tone,
    swatch: color.swatch,
    border: color.border,
    laneTint: color.laneTint,
    icon: icon.icon,
  };
}
