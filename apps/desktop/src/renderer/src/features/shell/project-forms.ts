/**
 * Client-side validation for the Projects sidebar forms. These are cheap
 * pre-checks only — the daemon revalidates everything (`project.add`
 * canonicalizes the path, `worktree.create` runs
 * `git_worktree::validate_worktree_add`) and its errors are shown verbatim,
 * so this module mirrors just the rules worth catching before an RPC.
 */

/** Error text, or null when the path is worth sending. */
export function validateProjectPath(raw: string): string | null {
  const path = raw.trim();
  if (!path) return "Enter a folder or repository path.";
  if (path.includes("\0")) return "The path must not contain NUL bytes.";
  return null;
}

/** Error text, or null when the display name is worth sending. */
export function validateProjectName(raw: string): string | null {
  if (!raw.trim()) return null;
  if (raw.includes("\0")) return "The name must not contain NUL bytes.";
  if (raw.trim().length > 256) return "Keep the name under 256 characters.";
  return null;
}

/**
 * Error text, or null when the worktree/branch name is worth sending.
 * Mirrors the cheap subset of the daemon's branch rules (no whitespace or
 * control characters, no `..`, no leading `/` or `-`, not bare `@`);
 * the daemon remains authoritative for the rest.
 */
export function validateWorktreeName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "Enter a name for the new worktree.";
  if (name.includes("\0")) return "The name must not contain NUL bytes.";
  if (name === "@") return "The name must not be the single character '@'.";
  if (/[\s\x00-\x1f\x7f]/.test(name))
    return "The name must not contain whitespace or control characters.";
  if (name.includes(".."))
    return "The name must not contain '..'.";
  if (name.startsWith("/") || name.startsWith("-"))
    return "The name must not start with '/' or '-'.";
  if (name.length > 256) return "Keep the name under 256 characters.";
  return null;
}

/**
 * Normalizes the optional base ref: blank means "daemon default"
 * (absent), anything else is trimmed. Never rejects — the daemon
 * resolves the ref against the repo and reports an unknown ref verbatim.
 */
export function normalizeBaseRef(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}
