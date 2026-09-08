// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/shared/utf8-byte-limits.ts (the two helpers the paste policy needs:
// bounds-safe code-point reads and UTF-8 byte lengths). The remaining
// measurement/clamp helpers of the source module have no Drogon consumer.

/**
 * Bounds-safe replacement for `String.prototype.codePointAt`.
 *
 * Why: once V8 optimizes the calling function, `codePointAt` on a sliced string pairs a
 * trailing high surrogate with the code unit that follows the SLICE inside its parent, so a
 * prefix slice cut mid-pair reports a code point the string does not contain (and one byte
 * more than it has). Reading surrogates out of the original string avoids that pairing.
 */
export function readUtf8CodePointAt(text: string, index: number): number {
  const leadUnit = text.charCodeAt(index);
  if (leadUnit < 0xd800 || leadUnit > 0xdbff) {
    return leadUnit;
  }
  const trailUnit = text.charCodeAt(index + 1);
  if (trailUnit < 0xdc00 || trailUnit > 0xdfff) {
    return leadUnit;
  }
  return (leadUnit - 0xd800) * 0x400 + (trailUnit - 0xdc00) + 0x10000;
}

export function getUtf8ByteLengthForCodePoint(codePoint: number): number {
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  if (codePoint <= 0xffff) {
    return 3;
  }
  return 4;
}
