// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/listing/section-order.ts
// (display-section shape and builders). Adapter: the MVP has no group-order
// setting and no conflict pinning, so sections build in the fixed
// staged-first order; the conflicts id is kept for the empty-state copy.

import type {
  SourceControlArea,
  SourceControlEntry,
} from "./source-control-entry";

export type SourceControlSectionArea = SourceControlArea;
export type SourceControlDisplaySectionId = SourceControlSectionArea | "conflicts";

export type SourceControlEntryGroups = Record<SourceControlArea, SourceControlEntry[]>;

export type SourceControlDisplaySection = {
  id: SourceControlDisplaySectionId;
  area: SourceControlSectionArea;
  items: SourceControlEntry[];
};

/** Fixed MVP order: Staged Changes, Changes, Untracked Files. */
export const SOURCE_CONTROL_SECTION_ORDER: readonly SourceControlSectionArea[] = [
  "staged",
  "unstaged",
  "untracked",
];

export function groupSourceControlEntries(
  entries: readonly SourceControlEntry[],
): SourceControlEntryGroups {
  const groups: SourceControlEntryGroups = { staged: [], unstaged: [], untracked: [] };
  for (const entry of entries) groups[entry.area].push(entry);
  return groups;
}

export function buildSourceControlDisplaySections(
  groups: SourceControlEntryGroups,
  order: readonly SourceControlSectionArea[] = SOURCE_CONTROL_SECTION_ORDER,
): SourceControlDisplaySection[] {
  const sections: SourceControlDisplaySection[] = [];
  for (const area of order) {
    const items = groups[area];
    if (items.length > 0) sections.push({ id: area, area, items });
  }
  return sections;
}
