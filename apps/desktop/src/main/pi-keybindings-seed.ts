// Product default: in Pi sessions Enter queues a follow-up instead of
// steering, and Opt+Enter steers. Pi hardwires submit-while-streaming to
// `steer` and the `app.message.followUp` action to `followUp`; the only
// supported way to swap them is keybindings.json (user bindings replace
// defaults per action, keybindings.md). Extensions cannot rebind built-in
// actions (registerShortcut only adds new ones) and PI_CODING_AGENT_DIR
// would isolate sessions/auth, so main fills the two keys into the user's
// real agent dir once at startup: absent keys only, explicit user values
// (including stock `"enter"`/`"alt+enter"`) always win, corrupt files are
// left untouched. Best effort: a seeding failure must never fail startup.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const PI_SUBMIT_ACTION = "tui.input.submit";
export const PI_FOLLOW_UP_ACTION = "app.message.followUp";

/** Enter queues follow-up; Opt+Enter submits (steers while working). */
export const PI_QUEUE_FOLLOW_UP_BINDINGS: Record<string, string> = {
  [PI_SUBMIT_ACTION]: "alt+enter",
  [PI_FOLLOW_UP_ACTION]: "enter",
};

export function resolvePiAgentDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const override = env.PI_CODING_AGENT_DIR?.trim();
  if (override) return override;
  return path.join(home, ".pi", "agent");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * Pure merge: fills Pi's queue-swap bindings for keys the user has not
 * customized. Returns the object to persist and whether it differs.
 */
export function applyPiQueueFollowUpSeed(existing: unknown): {
  next: Record<string, unknown>;
  changed: boolean;
} {
  const base = isPlainRecord(existing) ? { ...existing } : {};
  let changed = !isPlainRecord(existing);
  for (const [action, binding] of Object.entries(
    PI_QUEUE_FOLLOW_UP_BINDINGS,
  )) {
    if (!(action in base)) {
      base[action] = binding;
      changed = true;
    }
  }
  return { next: base, changed };
}

function sameBindingsFile(a: string, b: string): boolean {
  return a === b;
}

export async function seedPiQueueFollowUpKeybindings(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): Promise<{ seeded: boolean; agentDir: string }> {
  const agentDir = resolvePiAgentDir(env, home);
  try {
    await mkdir(agentDir, { recursive: true, mode: 0o700 });
    const file = path.join(agentDir, "keybindings.json");
    let raw: string | null = null;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") return { seeded: false, agentDir };
    }
    let existing: unknown = null;
    if (raw !== null) {
      try {
        existing = JSON.parse(raw);
      } catch {
        // A hand-edited file that no longer parses stays exactly as the
        // user left it; Pi itself would also refuse to apply it.
        return { seeded: false, agentDir };
      }
    }
    const { next, changed } = applyPiQueueFollowUpSeed(existing);
    if (!changed) return { seeded: false, agentDir };
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    if (raw !== null && sameBindingsFile(raw, serialized)) {
      return { seeded: false, agentDir };
    }
    // mode applies on creation only; an existing file keeps its permissions.
    await writeFile(file, serialized, { mode: 0o600 });
    return { seeded: true, agentDir };
  } catch {
    return { seeded: false, agentDir };
  }
}
