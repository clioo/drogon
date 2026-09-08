/* MIT Copyright (c) 2026 Lovecast Inc.
 * Token filter ported from the read-only reference
 * `src/renderer/src/components/cmd-j/palette-query-tokens.ts` approach
 * (exact > prefix > substring per token, filler-tolerant coverage gate),
 * matching the ranking already used by this repo's command registry.
 * Rewritten standalone over palette-row haystacks.
 */

function normalizeQuery(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
  return normalizeQuery(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

// Navigation filler carries no intent, so an unmatched filler word must
// not count against coverage.
const QUERY_FILLER_TOKENS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "go",
  "goto",
  "in",
  "into",
  "me",
  "my",
  "of",
  "on",
  "open",
  "please",
  "show",
  "the",
  "to",
  "view",
  "with",
]);

/** Per-token best tier: exact 3, prefix 2, substring 1, else 0. */
export function jumpTokenScore(
  queryTokens: readonly string[],
  values: readonly string[],
): number {
  const candidateTokens = values.flatMap(tokenize);
  if (candidateTokens.length === 0) return 0;
  let score = 0;
  let meaningful = 0;
  let covered = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    for (const candidateToken of candidateTokens) {
      if (candidateToken === queryToken) best = Math.max(best, 3);
      else if (candidateToken.startsWith(queryToken)) best = Math.max(best, 2);
      else if (candidateToken.includes(queryToken)) best = Math.max(best, 1);
    }
    score += best;
    if (QUERY_FILLER_TOKENS.has(queryToken)) continue;
    meaningful += 1;
    if (best > 0) covered += 1;
  }
  // A candidate must cover most of what was typed, not just one word of it.
  if (meaningful > 0 && covered * 2 <= meaningful) return 0;
  return score;
}

export function jumpQueryTokens(query: string): string[] {
  return [...new Set(tokenize(query))];
}

/**
 * Ranks haystack rows against a query. Empty query keeps definition order;
 * non-empty drops zero-score rows and sorts by score (stable for ties).
 */
export function rankJumpRows<T>(
  rows: readonly T[],
  haystack: (row: T) => readonly string[],
  query: string,
): T[] {
  const tokens = jumpQueryTokens(query);
  if (tokens.length === 0) return [...rows];
  const scored = rows
    .map((row, index) => ({ row, index, score: jumpTokenScore(tokens, haystack(row)) }))
    .filter((entry) => entry.score > 0);
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((entry) => entry.row);
}
