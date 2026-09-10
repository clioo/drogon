/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca
   src/renderer/src/lib/worktree-palette-query-bounds.ts at pinned source
   c9790628 (clioo/drogon-orca). Adaptation: the source delegates the byte
   measure to shared/clipboard-text (measureUtf8ByteLength with an early
   stop); Drogon has no such shared module, so this bounded TextEncoder
   measure reproduces the same over-limit verdict without the yield machinery. */

export const WORKTREE_PALETTE_QUERY_MAX_BYTES = 2 * 1024;

const encoder = new TextEncoder();

/** UTF-8 byte length, stopping as soon as `stopAfterBytes` is exceeded. */
function measureUtf8ByteLengthBounded(
  text: string,
  stopAfterBytes: number,
): number {
  const bytes = encoder.encode(text);
  return Math.min(bytes.length, stopAfterBytes + 1);
}

export function isClipboardTextByteLengthOverLimit(
  text: string,
  maxBytes: number,
): boolean {
  if (text.length > maxBytes) {
    // A UTF-16 code unit never encodes below one byte, so this alone can prove it.
    return true;
  }
  return measureUtf8ByteLengthBounded(text, maxBytes) > maxBytes;
}

export function isWorktreePaletteQueryTooLarge(
  query: string,
  maxBytes = WORKTREE_PALETTE_QUERY_MAX_BYTES,
): boolean {
  return isClipboardTextByteLengthOverLimit(query, maxBytes);
}
