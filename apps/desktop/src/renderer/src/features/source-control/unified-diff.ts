export type DiffLineKind =
  | "hunk"
  | "add"
  | "del"
  | "context"
  | "noeol"
  | "file";

export type DiffLine = { kind: DiffLineKind; text: string };
export type DiffHunk = { header: string; lines: DiffLine[] };
export type ParsedDiff = { hunks: DiffHunk[]; truncated: boolean };

/**
 * Minimal unified-diff parser for the Changes viewer: splits `@@` hunks,
 * classifies `+`/`-`/` ` lines, keeps `diff --git`/`+++`/`---` file markers
 * as file lines. Anything else (index lines, mode changes, `\ No newline`)
 * folds into file/noeol/context so the viewer never drops a line it cannot
 * classify — unknown lines render, they don't vanish.
 */
export function parseUnifiedDiff(
  text: string,
  maxLines = 2_000,
): ParsedDiff {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let lines = 0;
  let truncated = false;
  if (text === "") return { hunks, truncated };
  const push = (hunk: DiffHunk) => {
    hunks.push(hunk);
    current = hunk;
  };
  for (const raw of text.split("\n")) {
    if (lines >= maxLines) {
      truncated = true;
      break;
    }
    if (raw.startsWith("@@")) {
      push({ header: raw, lines: [] });
      lines += 1;
      continue;
    }
    let line: DiffLine;
    if (
      raw.startsWith("diff --git") ||
      raw.startsWith("+++") ||
      raw.startsWith("---") ||
      raw.startsWith("index ") ||
      // Extended-header lines of a patch (new/deleted file, mode changes,
      // renames/copies): metadata like `index`, never file content. Without
      // these, an untracked file's `new file mode 100644` was parsed as a
      // context line and leaked (minus its first char) into the viewer.
      raw.startsWith("new file mode ") ||
      raw.startsWith("deleted file mode ") ||
      raw.startsWith("old mode ") ||
      raw.startsWith("new mode ") ||
      raw.startsWith("similarity index ") ||
      raw.startsWith("dissimilarity index ") ||
      raw.startsWith("rename from ") ||
      raw.startsWith("rename to ") ||
      raw.startsWith("copy from ") ||
      raw.startsWith("copy to ")
    ) {
      line = { kind: "file", text: raw };
    } else if (raw.startsWith("\\")) {
      line = { kind: "noeol", text: raw };
    } else if (raw.startsWith("+")) {
      line = { kind: "add", text: raw };
    } else if (raw.startsWith("-")) {
      line = { kind: "del", text: raw };
    } else {
      line = { kind: "context", text: raw };
    }
    if (current === null) push({ header: "", lines: [] });
    current!.lines.push(line);
    lines += 1;
  }
  return { hunks, truncated };
}
