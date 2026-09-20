/* The Bots contract's one RUNTIME value, and the drift that broke it.
 *
 * `BOT_MONITOR_FIRING_OUTCOMES` is the desktop half of the daemon's
 * `FIRING_OUTCOMES`. They fell out of step once — the daemon grew
 * `dispatch_failed` (a refused `harness.start`) and this side did not —
 * and because the WHOLE `bot.monitor_list` result is validated before the
 * renderer sees it, that one unknown token failed the read for the bot and
 * erased every monitor it owned. The Bots page then reported it as "the
 * daemon bridge does not expose the monitor read" (#608).
 *
 * So this suite derives the daemon's set from the Rust source and fails
 * here — cheaply, in the unit suite — rather than in a user's panel. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BOT_MONITOR_FIRING_OUTCOMES } from "./bot-contract";

function daemonFiringOutcomes(): string[] {
  const source = readFileSync(
    fileURLToPath(
      new URL(
        "../../../../crates/drogon-core/src/bots/delegation.rs",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  const block = source.match(
    /pub const FIRING_OUTCOMES: &\[&str\] = &\[(.*?)\];/s,
  );
  if (!block) throw new Error("FIRING_OUTCOMES not found in delegation.rs");
  // Entries are either a string literal or a named constant; resolve the
  // named ones from their own `pub const NAME: &str = "value";`.
  return block[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const literal = entry.match(/^"([a-z_]+)"$/);
      if (literal) return literal[1];
      const named = source.match(
        new RegExp(`pub const ${entry}: &str = "([a-z_]+)";`),
      );
      if (!named) throw new Error(`cannot resolve FIRING_OUTCOMES entry ${entry}`);
      return named[1];
    });
}

describe("bot-contract: firing verdicts", () => {
  it("declares exactly the verdicts the daemon can write", () => {
    const daemon = daemonFiringOutcomes();
    expect(daemon.length).toBeGreaterThan(0);
    expect([...BOT_MONITOR_FIRING_OUTCOMES].sort()).toEqual([...daemon].sort());
    // The one that caused #608 is named explicitly, so deleting it from
    // either side is a failure here and not a mystery in the UI.
    expect(daemon).toContain("dispatch_failed");
    expect(BOT_MONITOR_FIRING_OUTCOMES).toContain("dispatch_failed");
  });

  it("keeps a refused dispatch distinct from a successful one", () => {
    expect(BOT_MONITOR_FIRING_OUTCOMES).toContain("dispatched");
    expect(new Set(BOT_MONITOR_FIRING_OUTCOMES).size).toBe(
      BOT_MONITOR_FIRING_OUTCOMES.length,
    );
  });
});
