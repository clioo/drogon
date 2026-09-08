/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/lib/create-untitled-markdown.ts (untitled.md, then
   untitled-N.md, EEXIST probing up to 100 attempts, throws instead of
   silently dropping). Adapter: creation goes through the daemon's
   files.create (workspace-relative, exclusive create) rather than the
   fork's runtime file client, so existence probing is attempt-and-advance
   on the daemon's "already exists" refusal; templates and SSH scoping are
   out of scope — the issue asks for a plain untitled file opened as an
   editor tab. Pure apart from the injected `createFile`, unit-tested. */

export const UNTITLED_MARKDOWN_BASE = "untitled";
export const UNTITLED_MARKDOWN_EXT = ".md";
export const MAX_UNTITLED_MARKDOWN_ATTEMPTS = 100;

/** Fork-exact sequence: `untitled.md`, then `untitled-2.md`, … */
export function untitledMarkdownName(attempt: number): string {
  if (attempt <= 1) return `${UNTITLED_MARKDOWN_BASE}${UNTITLED_MARKDOWN_EXT}`;
  return `${UNTITLED_MARKDOWN_BASE}-${attempt}${UNTITLED_MARKDOWN_EXT}`;
}

function isCollision(message: string): boolean {
  return message.includes("EEXIST") || message.includes("exists");
}

/**
 * Creates the first free untitled markdown name at the workspace root.
 * Returns the workspace-relative path. Throws on permission/transport
 * failures and after exhausting the sequence, so the caller surfaces the
 * failure instead of opening a tab for a file that does not exist.
 */
export async function createUntitledMarkdown(
  createFile: (name: string) => Promise<{ ok: true } | { ok: false; message: string }>,
  maxAttempts: number = MAX_UNTITLED_MARKDOWN_ATTEMPTS,
): Promise<string> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const name = untitledMarkdownName(attempt);
    const result = await createFile(name);
    if (result.ok) return name;
    if (!isCollision(result.message)) throw new Error(result.message);
  }
  throw new Error(
    `Unable to create untitled markdown file after ${maxAttempts} attempts.`,
  );
}
