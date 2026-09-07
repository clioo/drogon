// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/listing/uncommitted-sections.tsx.
// Adapter: the MVP entry model (no conflicts, submodules, combined-diff
// "View all" or notes); bulk stage/unstage/discard act on the unfiltered
// group and hide while filtering, exactly like the source.
import React from "react";
import { Minus, Plus, Trash, Undo2 } from "lucide-react";
import { ActionButton } from "./action-button";
import { SectionHeader } from "./section-header";
import { SourceControlSectionFileList, type SourceControlViewMode } from "./section-file-list";
import {
  getDiscardAllPaths,
  getStageAllPaths,
  getUnstageAllPaths,
  type DiscardAllArea,
  type StageAllArea,
} from "./discard-sequence";
import type {
  SourceControlDisplaySection,
  SourceControlDisplaySectionId,
} from "./section-order";
import type { SourceControlEntry } from "./source-control-entry";

const SECTION_LABELS: Record<DiscardAllArea, string> = {
  staged: "Staged Changes",
  unstaged: "Changes",
  untracked: "Untracked Files",
};

export function SourceControlUncommittedSections(props: {
  displaySections: SourceControlDisplaySection[];
  unfilteredDisplaySectionsById: ReadonlyMap<
    SourceControlDisplaySectionId,
    SourceControlDisplaySection
  >;
  normalizedFilter: string;
  collapsedSections: Set<string>;
  toggleSection: (id: string) => void;
  isExecutingBulk: boolean;
  requestDiscardAllInArea: (area: DiscardAllArea, paths?: readonly string[]) => void;
  handleStageAllPaths: (paths: readonly string[]) => Promise<void>;
  handleUnstagePaths: (paths: readonly string[]) => Promise<void>;
  sourceControlViewMode: SourceControlViewMode;
  collapsedTreeDirs: Set<string>;
  toggleTreeDir: (key: string) => void;
  requestDiscardPaths: (area: DiscardAllArea, paths: readonly string[]) => void;
  selectedKeySet: ReadonlySet<string>;
  activeOpenRowKeys: ReadonlySet<string>;
  handleSelect: (key: string) => void;
  handleContextMenu: (key: string) => void;
  handleOpenDiff: (entry: SourceControlEntry) => void;
  handleStage: (path: string) => Promise<void>;
  handleUnstage: (path: string) => Promise<void>;
  requestDiscardEntry: (entry: SourceControlEntry) => void;
}): React.JSX.Element {
  return (
    <>
      {props.displaySections.map((section) => {
        const { area, id, items } = section;
        const isCollapsed = props.collapsedSections.has(id);
        // Why: bulk stage/unstage act on the *unfiltered* group; the +/- hides while filtering to avoid acting on more than what's shown.
        // Why: visibility and execution resolve paths via the same eligibility rules, so the button never shows for a set the handler would filter to empty.
        const actionSection = props.unfilteredDisplaySectionsById.get(id) ?? section;
        const actionItems = actionSection.items;
        const stageAllPaths =
          area === "unstaged" || area === "untracked"
            ? getStageAllPaths(actionItems, area as StageAllArea)
            : [];
        const unstageAllPaths = area === "staged" ? getUnstageAllPaths(actionItems) : [];
        const discardAllPaths = getDiscardAllPaths(actionItems, area);
        const canStageAll = !props.normalizedFilter && stageAllPaths.length > 0;
        const canUnstageAll = !props.normalizedFilter && unstageAllPaths.length > 0;
        const canRevertAll = !props.normalizedFilter && discardAllPaths.length > 0;
        return (
          <div key={id}>
            <SectionHeader
              label={SECTION_LABELS[area]}
              count={items.length}
              isCollapsed={isCollapsed}
              onToggle={() => props.toggleSection(id)}
              actions={
                // Why: bulk actions are hover-only, but forced visible on no-hover pointers (touch/SSH). One wrapper so focusing any action reveals all three (else keyboard tabs into an invisible stop).
                <div className="flex items-center can-hover:opacity-0 transition-opacity group-hover/section:opacity-100 focus-within:opacity-100">
                  {canRevertAll && (
                    <ActionButton
                      icon={area === "untracked" ? Trash : Undo2}
                      title={area === "untracked" ? "Delete all untracked" : "Discard all"}
                      onClick={(event) => {
                        event.stopPropagation();
                        props.requestDiscardAllInArea(area, discardAllPaths);
                      }}
                      disabled={props.isExecutingBulk}
                    />
                  )}
                  {canStageAll && (
                    <ActionButton
                      icon={Plus}
                      title="Stage all"
                      onClick={(event) => {
                        event.stopPropagation();
                        void props.handleStageAllPaths(stageAllPaths);
                      }}
                      disabled={props.isExecutingBulk}
                    />
                  )}
                  {canUnstageAll && (
                    <ActionButton
                      icon={Minus}
                      title="Unstage all"
                      onClick={(event) => {
                        event.stopPropagation();
                        void props.handleUnstagePaths(unstageAllPaths);
                      }}
                      disabled={props.isExecutingBulk}
                    />
                  )}
                </div>
              }
            />
            {!isCollapsed && (
              <SourceControlSectionFileList
                entries={items}
                area={area}
                sourceControlViewMode={props.sourceControlViewMode}
                normalizedFilter={props.normalizedFilter}
                isExecutingBulk={props.isExecutingBulk}
                collapsedTreeDirs={props.collapsedTreeDirs}
                toggleTreeDir={props.toggleTreeDir}
                requestDiscardPaths={props.requestDiscardPaths}
                handleStageAllPaths={props.handleStageAllPaths}
                handleUnstagePaths={props.handleUnstagePaths}
                selectedKeySet={props.selectedKeySet}
                activeOpenRowKeys={props.activeOpenRowKeys}
                handleSelect={props.handleSelect}
                handleContextMenu={props.handleContextMenu}
                handleOpenDiff={props.handleOpenDiff}
                handleStage={props.handleStage}
                handleUnstage={props.handleUnstage}
                requestDiscardEntry={props.requestDiscardEntry}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
