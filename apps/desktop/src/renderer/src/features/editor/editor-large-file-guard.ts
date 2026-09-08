// MIT Copyright (c) 2026 Lovecast Inc. Not a direct port: the reference's
// large-content guards (markdown-rich-size-limit.ts, large-diff-render-
// limit.ts) gate RICH views with full file content available. This app's
// `files.read` bridge already fails a read closed above
// `MAX_FILE_BYTES` (64 KiB, see shared/file-contract.ts), so a file that
// large never reaches the editor as "read ok" content in the first place —
// this guard is a defensive backstop against Monaco itself (large single
// lines, huge generated files) reaching the pane through any future read
// path that does not share that cap.
export const LARGE_FILE_MONACO_CHAR_LIMIT = 300_000;

/** Whether `content` is large enough that mounting Monaco should be skipped in favor of a plain read-only view. */
export function shouldUseLargeFileFallback(contentLength: number): boolean {
  return contentLength > LARGE_FILE_MONACO_CHAR_LIMIT;
}
