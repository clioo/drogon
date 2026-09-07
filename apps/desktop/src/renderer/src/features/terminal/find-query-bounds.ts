// MIT Copyright (c) 2026 Lovecast Inc. Ported verbatim from
// src/renderer/src/lib/find-query-bounds.ts.

export const FIND_QUERY_MAX_BYTES = 2 * 1024;

function isClipboardTextByteLengthOverLimit(
  text: string,
  maxBytes: number,
): boolean {
  return new TextEncoder().encode(text).length > maxBytes;
}

export function isFindQueryTooLarge(
  query: string,
  maxBytes = FIND_QUERY_MAX_BYTES,
): boolean {
  return isClipboardTextByteLengthOverLimit(query, maxBytes);
}

export function getFindRequestQuery(query: string): string | null {
  return isFindQueryTooLarge(query) ? null : query;
}
