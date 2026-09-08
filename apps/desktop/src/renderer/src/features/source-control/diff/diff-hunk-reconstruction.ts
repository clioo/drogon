// MIT Copyright (c) 2026 Lovecast Inc. Not a port: the source's DiffViewer
// (DiffViewer.tsx) takes full original/modified FILE content as props —
// Orca's app reads both sides through its own git content RPC. This repo's
// `git.diff` RPC (shared/git-contract.ts) returns only unified-diff TEXT
// (MAX_GIT_DIFF_CHARS-capped) and there is no "read file at ref" RPC to
// add (crates/drogon-protocol is coordinator-owned). This module
// reconstructs the two sides Monaco's DiffEditor needs directly from the
// hunks in that text.
//
// Known fidelity gap (documented in the PR): reconstructed line numbers are
// relative to the shown hunk excerpt, not the file's true line numbers,
// because a unified diff omits unchanged regions far from any hunk. A gap
// marker line is inserted into BOTH sides between non-adjacent hunks
// (identical text on each side, so Monaco's own diff never flags it as a
// change) purely so the reader can see where the excerpt skips forward.
import { parseUnifiedDiff } from "../unified-diff";

const GAP_MARKER = "⋯";

export type ReconstructedDiff = {
  original: string;
  modified: string;
  /** False when there is nothing to show (e.g. an untracked file, or an empty diff). */
  hasContent: boolean;
  /** The same display-budget truncation `unified-diff.ts`'s text view already surfaced. */
  truncated: boolean;
};

export function reconstructDiffContent(diffText: string): ReconstructedDiff {
  const { hunks, truncated } = parseUnifiedDiff(diffText);
  const original: string[] = [];
  const modified: string[] = [];
  // Why not `index > 0`: `parseUnifiedDiff` folds any file-header lines
  // (diff --git / index / --- / +++) that precede the first `@@` into a
  // synthetic leading hunk with an empty header. That hunk contributes no
  // original/modified content (its lines are all "file" kind, skipped
  // below), so gating the gap marker on "a REAL hunk already emitted
  // content" — not on hunk index — keeps the very first visible hunk
  // marker-free.
  let hasEmittedContent = false;

  for (const hunk of hunks) {
    const before = original.length + modified.length;
    if (hasEmittedContent) {
      original.push(GAP_MARKER);
      modified.push(GAP_MARKER);
    }
    const gapMarkerLength = hasEmittedContent ? 2 : 0;
    for (const line of hunk.lines) {
      switch (line.kind) {
        case "context":
          original.push(line.text.slice(1));
          modified.push(line.text.slice(1));
          break;
        case "del":
          original.push(line.text.slice(1));
          break;
        case "add":
          modified.push(line.text.slice(1));
          break;
        // "file" (diff --git / +++ / --- / index) and "noeol" (\ No newline
        // at end of file) lines are diff metadata, not file content.
        case "file":
        case "noeol":
        case "hunk":
          break;
      }
    }
    const contributedContent = original.length + modified.length - before - gapMarkerLength > 0;
    if (contributedContent) {
      hasEmittedContent = true;
    } else if (gapMarkerLength > 0) {
      // This hunk turned out to contribute nothing (defensive — real diff
      // text always has content after a `@@` header) — drop the marker we
      // speculatively pushed for it so a trailing empty hunk can't leave a
      // dangling "⋯" with nothing after it.
      original.pop();
      modified.pop();
    }
  }

  return {
    original: original.join("\n"),
    modified: modified.join("\n"),
    hasContent: hasEmittedContent,
    truncated,
  };
}
