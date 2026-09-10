/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca pinned source
   c9790628 (clioo/drogon-orca):
   - matchWorkspaceBoardWorktrees / buildWorkspaceKanbanLaneViews from
     src/renderer/src/components/sidebar/workspace-kanban-search.ts,
   - the board-evidence document profile from
     src/renderer/src/lib/worktree-palette-document.ts (evidencePolicy
     'board': visible name/branch/repo/host fields plus the comment unit
     only — palette-only evidence such as ports, reviews, issues and
     automations is excluded),
   - comment unit from src/renderer/src/lib/worktree-palette-evidence.ts.
   Adaptations (data layer only): `Repo` is Drogon's `Project` (repoMap ->
   projectById), and the host label uses the row's host id with the source's
   local-host chip rule. Matching semantics, profiles and composite pairs are
   the source's. */
import { getWorktreeHostIdentity } from "./host-identity";
import {
  resolveWorktreeBranchLabel,
  type KanbanWorktree,
} from "./kanban-worktree";
import { matchPaletteDocument } from "./palette-match/match-document";
import {
  buildPaletteDocument,
  type PaletteDocument,
  type PaletteDocumentMatch,
  type PaletteDocumentRank,
} from "./palette-match/palette-document";
import {
  composePaletteEvidence,
  type PaletteComposedEvidence,
} from "./palette-match/evidence-composer";
import { preparePaletteQuery } from "./palette-match/palette-query";
import { isWorktreePaletteQueryTooLarge as isBoardQueryTooLarge } from "./worktree-palette-query-bounds";
import type { Project } from "../../../../shared/session-contract";

const BOARD_FIELD_ID_NAME = "name";
const BOARD_FIELD_ID_BRANCH = "branch";
const BOARD_FIELD_ID_REPO = "repo";
const BOARD_FIELD_ID_HOST = "host";
const BOARD_FIELD_ID_COMMENT = "comment#text";

/** LOCAL host renders no chip in Orca's sidebar; the same rule hides it here. */
const LOCAL_HOST_ID = "local";

export type WorkspaceKanbanLaneView = {
  items: readonly KanbanWorktree[];
  totalCount: number;
};

function buildBoardCommentEvidence(
  comment: string,
): PaletteComposedEvidence | null {
  return composePaletteEvidence({
    id: "comment",
    kind: "comment",
    accessibilityLabel: "Workspace comment",
    parts: [{ key: "text", text: comment, profile: "prose" }],
  });
}

export function buildBoardDocument(
  worktree: KanbanWorktree,
  projectById: ReadonlyMap<string, Project>,
): PaletteDocument {
  const project = projectById.get(worktree.projectId);
  return buildPaletteDocument({
    id: worktree.id,
    visibleFields: [
      {
        id: BOARD_FIELD_ID_NAME,
        profile: "structured-label",
        // The adapter row's coalesced display name (custom title -> branch ->
        // path basename), exactly what the source renders on the card.
        text: worktree.displayName,
      },
      {
        id: BOARD_FIELD_ID_BRANCH,
        profile: "structured-label",
        text: resolveWorktreeBranchLabel(worktree),
      },
      {
        id: BOARD_FIELD_ID_REPO,
        profile: "structured-label",
        text: project?.name ?? "",
      },
      {
        id: BOARD_FIELD_ID_HOST,
        profile: "structured-label",
        // Why conditional: the host chip only renders for active remote hosts, and
        // an unrendered match would be unexplainable on the row.
        text:
          worktree.hostId && worktree.hostId !== LOCAL_HOST_ID
            ? worktree.hostId
            : "",
      },
    ],
    compositePairs: [
      {
        leftFieldId: BOARD_FIELD_ID_REPO,
        rightFieldId: BOARD_FIELD_ID_BRANCH,
      },
      { leftFieldId: BOARD_FIELD_ID_REPO, rightFieldId: BOARD_FIELD_ID_NAME },
    ],
    evidence: (() => {
      const comment = buildBoardCommentEvidence(worktree.comment ?? "");
      // Board evidence policy: the comment unit is the only supporting text.
      return comment ? [{ unit: comment.unit, fields: comment.fields }] : [];
    })(),
  });
}

type BoardMatchedField = "displayName" | "branch" | "repo" | "host" | "comment";

const VISIBLE_FIELD_LABELS: ReadonlyMap<string, BoardMatchedField> = new Map([
  [BOARD_FIELD_ID_NAME, "displayName"],
  [BOARD_FIELD_ID_BRANCH, "branch"],
  [BOARD_FIELD_ID_REPO, "repo"],
  [BOARD_FIELD_ID_HOST, "host"],
]);

function toBoardMatchedFields(
  match: PaletteDocumentMatch,
): BoardMatchedField[] {
  const matchedFields: BoardMatchedField[] = [];
  for (const fieldId of match.rangesByField.keys()) {
    const label = VISIBLE_FIELD_LABELS.get(fieldId);
    if (label && !matchedFields.includes(label)) {
      matchedFields.push(label);
      continue;
    }
    if (
      fieldId === BOARD_FIELD_ID_COMMENT &&
      !matchedFields.includes("comment")
    ) {
      matchedFields.push("comment");
    }
  }
  return matchedFields;
}

export type BoardSearchResult = {
  worktreeId: string;
  /** Why (STA-4343): `projectId::path` repeats across hosts, so consumers that key on a
   *  result — board filters, item ids — need the host to tell two rows apart. */
  worktreeHostId?: string;
  matchedFields: readonly BoardMatchedField[];
  qualityClass: PaletteDocumentMatch["qualityClass"];
  rank: PaletteDocumentRank;
};

/**
 * Matches prepared documents; callers memoize `documents` across keystrokes.
 * Returns results for the worktrees that matched; a worktree absent from the
 * result list did not match the query.
 */
export function searchBoardWorktrees(
  worktrees: readonly KanbanWorktree[],
  query: string,
  projectById: ReadonlyMap<string, Project>,
): BoardSearchResult[] {
  const prepared = preparePaletteQuery(query);
  if (prepared.state === "invalid") {
    return [];
  }
  if (prepared.state === "empty") {
    return [];
  }

  const results: BoardSearchResult[] = [];
  for (const worktree of worktrees) {
    const document = buildBoardDocument(worktree, projectById);
    const match = matchPaletteDocument({
      document,
      tokens: prepared.tokens,
      normalizedQuery: prepared.normalized,
    });
    if (match) {
      results.push({
        worktreeId: worktree.id,
        worktreeHostId: worktree.hostId,
        matchedFields: toBoardMatchedFields(match),
        qualityClass: match.qualityClass,
        rank: match.rank,
      });
    }
  }
  return results;
}

// Why: the board is a drag surface for named workspaces, so a card may only be
// hidden by fields the user can read on it. PR/issue/port matches are palette-only.
/**
 * Returns `null` when no filtering is active — distinct from an empty set, which
 * means a real query matched nothing.
 */
export function matchWorkspaceBoardWorktrees(args: {
  worktrees: KanbanWorktree[];
  query: string;
  projectById: ReadonlyMap<string, Project>;
}): ReadonlySet<string> | null {
  if (!args.query.trim()) {
    return null;
  }
  // Why: search returns [] for an over-bound query, which downstream reads as
  // "matched nothing" and blanks the whole board on a paste accident — so an
  // over-bound query returns null (no filtering) instead.
  if (isBoardQueryTooLarge(args.query)) {
    return null;
  }

  const matched = new Set<string>();
  // Why the board policy (#15170): a card may only be hidden by text printed on it, so
  // palette-only evidence such as ports, reviews and automation runs is excluded.
  for (const result of searchBoardWorktrees(
    args.worktrees,
    args.query,
    args.projectById,
  )) {
    if (result.matchedFields.length) {
      // Why (STA-4343): two hosts can publish the same id, and a board filter keyed on the
      // bare id would show or hide both hosts' cards together.
      matched.add(
        getWorktreeHostIdentity({
          id: result.worktreeId,
          hostId: result.worktreeHostId,
        }),
      );
    }
  }
  return matched;
}

export function buildWorkspaceKanbanLaneViews(args: {
  worktreesByStatus: ReadonlyMap<string, readonly KanbanWorktree[]>;
  matchingWorktreeIds: ReadonlySet<string> | null;
}): Map<string, WorkspaceKanbanLaneView> {
  const matchingWorktreeIds = args.matchingWorktreeIds;
  const views = new Map<string, WorkspaceKanbanLaneView>();
  for (const [status, items] of args.worktreesByStatus) {
    views.set(status, {
      // Why: the no-query path must not reallocate a lane array per keystroke.
      items: matchingWorktreeIds
        ? items.filter((worktree) =>
            matchingWorktreeIds.has(getWorktreeHostIdentity(worktree)),
          )
        : items,
      totalCount: items.length,
    });
  }
  return views;
}
