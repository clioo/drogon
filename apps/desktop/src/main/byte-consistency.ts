/** True when the service's reported accepted-byte count does not match what was actually sent as UTF-8 — like the CLI's own write-correction check. */
export function writeByteCountMismatches(
  text: string,
  acceptedBytes: number,
): boolean {
  return Buffer.byteLength(text, "utf8") !== acceptedBytes;
}

/** True when a read's cursor advance does not match the actual decoded byte length of `dataBase64`. */
export function readCursorMismatches(
  dataBase64: string,
  startCursor: number,
  nextCursor: number,
): boolean {
  return nextCursor - startCursor !== Buffer.from(dataBase64, "base64").length;
}
