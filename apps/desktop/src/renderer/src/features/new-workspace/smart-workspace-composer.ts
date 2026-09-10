/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/shared/workspace-name.ts (slugifyForWorkspaceName and its text
   scanner) plus re-exports of the smart-field model types the composer
   card shares with the name section. */

export type {
  SmartNameMode,
  SmartWorkspaceNameSelection,
  GitHubWorkItem,
} from "./smart-workspace-source-rows";

function isWorkspaceNameWhitespace(code: number): boolean {
  return (
    code === 32 ||
    (code >= 9 && code <= 13) ||
    code === 160 ||
    code === 5760 ||
    (code >= 8192 && code <= 8202) ||
    code === 8232 ||
    code === 8233 ||
    code === 8239 ||
    code === 8287 ||
    code === 12288
  );
}

function foldWorkspaceNameWhitespaceToHyphen(input: string): string {
  let result = "";
  let pendingHyphen = false;
  for (let index = 0; index < input.length; index += 1) {
    if (isWorkspaceNameWhitespace(input.charCodeAt(index))) {
      pendingHyphen = true;
      continue;
    }
    if (pendingHyphen) {
      result += "-";
      pendingHyphen = false;
    }
    result += input[index];
  }
  return pendingHyphen ? `${result}-` : result;
}

function normalizeApostrophes(input: string): string {
  return input.replace(/['']/g, "'");
}

// Why: contractions and possessives should not become stray `t` / `s` tokens
// in display names or extra hyphen segments in branch-safe workspace seeds.
function removeIntraWordApostrophes(input: string): string {
  return normalizeApostrophes(input).replace(
    /([\p{L}\p{N}])'(?=[\p{L}\p{N}])/gu,
    "$1",
  );
}

/** Git/ref-safe workspace seed: lowercased, whitespace folded to hyphens,
 *  ref-hostile characters stripped, capped at 48 chars (the source's
 *  slugifyForWorkspaceName). */
export function slugifyForWorkspaceName(input: string): string {
  const normalized = removeIntraWordApostrophes(input)
    .trim()
    .toLowerCase()
    .replace(/[/\\]+/g, "-");
  return (
    foldWorkspaceNameWhitespaceToHyphen(normalized)
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      // Why: git check-ref-format rejects any ref containing `..`, so
      // previews must match the sanitizers before workspace creation.
      .replace(/\.{2,}/g, ".")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 48)
      .replace(/[-._]+$/g, "")
  );
}
