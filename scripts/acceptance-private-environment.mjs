import path from "node:path";
import { mkdir } from "node:fs/promises";

/** Applies only to this acceptance process and its owned descendants.
 * Interactive session admission deliberately strips PI_CODING_AGENT_DIR;
 * therefore the normal HOME/.pi/agent fallback must ALSO be private. */
export async function installPrivateAcceptanceEnvironment(fixture, env = process.env) {
  const home = path.join(fixture, "home");
  const piDir = path.join(home, ".pi", "agent");
  await mkdir(piDir, { recursive: true });
  const replacements = {
    HOME: home, USERPROFILE: home, ZDOTDIR: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    PI_CODING_AGENT_DIR: piDir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1",
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"), CODEX_HOME: path.join(home, ".codex"),
    GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
    BASH_ENV: "", ENV: "",
  };
  const keys = new Set([...Object.keys(replacements), ...Object.keys(env).filter((key) => /TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|AUTH_SOCK/i.test(key))]);
  const previous = new Map([...keys].map((key) => [key, env[key]]));
  for (const key of keys) delete env[key];
  Object.assign(env, replacements);
  let restored = false;
  return { home, piDir, restore() {
    if (restored) return;
    restored = true;
    for (const [key, value] of previous) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  } };
}
