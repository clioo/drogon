import path from "node:path";

/**
 * A GUI-launched packaged app (Finder/Dock double-click, not a terminal) can
 * inherit a much shorter `PATH` than an interactive shell — harness
 * discovery on the service side reads this same `PATH`, so a harness
 * installed only via a shell-profile-managed location would otherwise
 * silently read as `missing`. This appends the well-known fallback
 * locations *without* ever spawning a shell or reading `~/.zshrc`/`~/.bash_
 * profile`/credentials — only `process.env.PATH` plus a fixed list.
 */
export function buildDaemonPath(
  existingPath: string | undefined,
  platform: NodeJS.Platform,
  home: string,
): string {
  const separator = platform === "win32" ? ";" : ":";
  const existing = (existingPath ?? "")
    .split(separator)
    .filter((entry) => entry.length > 0);
  const fallbacks =
    platform === "win32"
      ? []
      : [
          path.join(home, ".local", "bin"),
          path.join(home, ".opencode", "bin"),
          path.join(home, ".bun", "bin"),
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin",
        ];
  const merged = [...existing];
  for (const candidate of fallbacks) {
    if (!merged.includes(candidate)) merged.push(candidate);
  }
  return merged.join(separator);
}
