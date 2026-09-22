// Unit companion for scripts/accept-sidebar-agent-tree.mjs: covers the pure
// projections the acceptance run asserts through, so a silent change to
// either side breaks loudly. Never launches a daemon, an Electron app or a
// PTY.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  ACCEPTANCE_RUST_BUILD,
  CHECK_NAMES,
  COLLAPSE_STORAGE_KEY,
  ELF_MAGIC_HEX,
  MACH_O_MAGICS,
  TIMED_SLEEPER_C_SOURCE,
  isNativeCompiledSleeper,
  isObservedClaudeSession,
  isObservedPiSession,
  nativeSleeperFormatName,
  parseCollapsedLineageEnvelope,
  projectAgentTreeRow,
  projectBinaryIdentity,
  projectLateForegroundSnapshot,
  quoteShellWord,
  rootRowTextIsAgentNotTerminal,
} from "./accept-sidebar-agent-tree.mjs";

const execFileAsync = promisify(execFile);

describe("accept-sidebar-agent-tree check names", () => {
  it("names the nine acceptance checks in order", () => {
    assert.deepEqual(CHECK_NAMES, [
      "folder-workspace-hosts-the-agent-session",
      "daemon-observes-the-agent-started-inside-a-shell",
      "root-row-reads-the-agent-not-terminal-1-zsh",
      "sidebar-shows-a-three-level-tree",
      "collapsing-the-root-hides-both-descendants",
      "collapsing-depth-two-keeps-depth-one-visible",
      "the-fold-survives-a-reload",
      "expanding-restores-the-whole-path",
      "orchestration-worker-nests-under-the-session-that-started-it",
    ]);
  });
});

describe("collapse storage key", () => {
  it("matches the worktree-card expansion-state module", () => {
    assert.equal(COLLAPSE_STORAGE_KEY, "drogon:shell:collapsed-lineage-parents");
  });
});

describe("timed sleeper source", () => {
  it("is a real C program that sleeps argv[1]", () => {
    assert.match(TIMED_SLEEPER_C_SOURCE, /int main\(int argc, char \*\*argv\)/);
    assert.match(TIMED_SLEEPER_C_SOURCE, /sleep\(s\)/);
    assert.match(TIMED_SLEEPER_C_SOURCE, /atoi\(argv\[1\]\)/);
  });
});

describe("quoteShellWord", () => {
  it("passes plain paths through in single quotes", () => {
    assert.equal(quoteShellWord("/tmp/dg-622-abc/claude"), "'/tmp/dg-622-abc/claude'");
  });

  it("escapes embedded single quotes", () => {
    assert.equal(quoteShellWord("a'b"), "'a'\\''b'");
  });
});

describe("projectAgentTreeRow", () => {
  it("projects levels and depths to numbers", () => {
    assert.deepEqual(
      projectAgentTreeRow({
        sessionId: "s1",
        cardId: "c1",
        level: "1",
        depth: "0",
        expanded: "true",
        text: "Claude",
        hasTerminalSvg: false,
        identityTitle: "Claude",
      }),
      {
        sessionId: "s1",
        cardId: "c1",
        level: 1,
        depth: 0,
        expanded: "true",
        text: "Claude",
        hasTerminalSvg: false,
        identityTitle: "Claude",
      },
    );
  });

  it("nulls missing ids and non-numeric levels instead of passing NaN through", () => {
    const projected = projectAgentTreeRow({ level: "x", depth: null });
    assert.equal(projected.sessionId, null);
    assert.equal(projected.cardId, null);
    assert.equal(projected.level, null);
    assert.equal(projected.depth, null);
  });

  it("keeps a leaf's absent aria-expanded as null", () => {
    assert.equal(projectAgentTreeRow({ level: "3", depth: "2", expanded: null }).expanded, null);
  });
});

describe("parseCollapsedLineageEnvelope", () => {
  it("parses the worktree-to-folded-ids map", () => {
    assert.deepEqual(parseCollapsedLineageEnvelope('{"wt-1":["s-2"]}'), { "wt-1": ["s-2"] });
  });

  it("degrades missing, empty or corrupt values to null", () => {
    assert.equal(parseCollapsedLineageEnvelope(null), null);
    assert.equal(parseCollapsedLineageEnvelope(""), null);
    assert.equal(parseCollapsedLineageEnvelope("not json"), null);
    assert.equal(parseCollapsedLineageEnvelope('["wt-1"]'), null);
  });

  it("drops non-string ids and empty folds", () => {
    assert.deepEqual(parseCollapsedLineageEnvelope('{"wt-1":["s-2",42,""],"wt-2":[]}'), {
      "wt-1": ["s-2"],
    });
  });
});

describe("isObservedClaudeSession", () => {
  it("matches a plain shell foregrounding the fixture", () => {
    assert.equal(isObservedClaudeSession({ harnessId: null, observedHarnessId: "claude" }), true);
  });

  it("rejects launched harnesses, other observations and missing rows", () => {
    assert.equal(isObservedClaudeSession({ harnessId: "pi", observedHarnessId: "claude" }), false);
    assert.equal(isObservedClaudeSession({ harnessId: null, observedHarnessId: null }), false);
    assert.equal(isObservedClaudeSession({ harnessId: null, observedHarnessId: "pi" }), false);
    assert.equal(isObservedClaudeSession(null), false);
  });
});

describe("isObservedPiSession", () => {
  it("matches a plain shell foregrounding the pi fixture", () => {
    assert.equal(isObservedPiSession({ harnessId: null, observedHarnessId: "pi" }), true);
    assert.equal(isObservedPiSession({ observedHarnessId: "pi" }), true);
  });

  it("rejects launched harnesses, other observations and missing rows", () => {
    assert.equal(isObservedPiSession({ harnessId: "pi", observedHarnessId: "pi" }), false);
    assert.equal(isObservedPiSession({ harnessId: null, observedHarnessId: null }), false);
    assert.equal(isObservedPiSession({ harnessId: null, observedHarnessId: "claude" }), false);
    assert.equal(isObservedPiSession(null), false);
  });
});

describe("projectLateForegroundSnapshot", () => {
  it("records daemon identity, observation, state and DOM text side by side", () => {
    assert.deepEqual(
      projectLateForegroundSnapshot(
        {
          harnessId: null,
          observedHarnessId: "pi",
          observedHarnessAt: "2026-09-22T00:01:00Z",
          hasForegroundChild: true,
          agentState: "unknown",
          agentStateAuthority: null,
        },
        { text: "Pi - No update in 0m", identityTitle: "Pi" },
      ),
      {
        harnessId: null,
        observedHarnessId: "pi",
        observedHarnessAt: "2026-09-22T00:01:00Z",
        hasForegroundChild: true,
        agentState: "unknown",
        agentStateAuthority: null,
        domText: "Pi - No update in 0m",
        domIdentityTitle: "Pi",
      },
    );
  });

  it("accepts measureGuideRows rows and nulls missing fields", () => {
    assert.deepEqual(projectLateForegroundSnapshot({}, { primaryText: "Terminal 4" }), {
      harnessId: null,
      observedHarnessId: null,
      observedHarnessAt: null,
      hasForegroundChild: null,
      agentState: null,
      agentStateAuthority: null,
      domText: "Terminal 4",
      domIdentityTitle: null,
    });
    assert.deepEqual(projectLateForegroundSnapshot(null, null), {
      harnessId: null,
      observedHarnessId: null,
      observedHarnessAt: null,
      hasForegroundChild: null,
      agentState: null,
      agentStateAuthority: null,
      domText: null,
      domIdentityTitle: null,
    });
  });
});

describe("acceptance rust build spec", () => {
  it("builds the daemon and CLI from the current tree, locked", () => {
    assert.deepEqual(ACCEPTANCE_RUST_BUILD, {
      command: "cargo",
      args: ["build", "-p", "drogond", "-p", "drogon-cli", "--locked"],
      timeoutMs: 600000,
    });
  });
});

describe("projectBinaryIdentity", () => {
  it("records the resolved path with the post-build mtime and size", () => {
    const here = fileURLToPath(import.meta.url);
    const stats = statSync(here);
    assert.deepEqual(projectBinaryIdentity(here, stats), {
      path: here,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    });
  });

  it("nulls missing stats instead of passing undefined through", () => {
    assert.deepEqual(projectBinaryIdentity("/tmp/drogond", null), {
      path: "/tmp/drogond",
      mtimeMs: null,
      size: null,
    });
  });
});

describe("binary provenance guard wiring", () => {
  // The run itself needs a real desktop and daemon, so the companion pins
  // the wiring as source shape: reverting the build step must fail here.
  const source = readFileSync(
    fileURLToPath(import.meta.url).replace(/\.test\.mjs$/, ".mjs"),
    "utf8",
  );

  it("says why the build is part of the acceptance", () => {
    assert.match(source, /certified a stale/);
  });

  it("builds the spec binaries before the daemon starts", () => {
    assert.match(source, /await exec\(ACCEPTANCE_RUST_BUILD\.command/);
    assert.ok(
      source.indexOf("ACCEPTANCE_RUST_BUILD.command") < source.indexOf("start(daemonBinary"),
      "the build precedes the first use of either binary",
    );
  });

  it("records post-build mtimes and HEAD in the report", () => {
    assert.match(source, /report\.binaries\s*=/);
    assert.match(source, /projectBinaryIdentity\(daemonBinary, drogondStat\)/);
    assert.match(source, /\["rev-parse", "HEAD"\]/);
  });
});

describe("nativeSleeperFormatName", () => {
  it("names the compiled format each supported platform produces", () => {
    assert.equal(nativeSleeperFormatName("darwin"), "Mach-O");
    assert.equal(nativeSleeperFormatName("linux"), "ELF");
  });
});

describe("isNativeCompiledSleeper on darwin", () => {
  it("accepts every known Mach-O header", () => {
    assert.ok(MACH_O_MAGICS.has("cffaedfe"), "the arm64 header cc emits stays covered");
    assert.ok(MACH_O_MAGICS.has("cafebabe"), "the universal header stays covered");
    for (const hex of MACH_O_MAGICS) {
      assert.equal(
        isNativeCompiledSleeper(Buffer.from(hex, "hex"), "darwin"),
        true,
        hex,
      );
    }
  });

  it("rejects ELF binaries, shell scripts and short input", () => {
    assert.equal(isNativeCompiledSleeper(Buffer.from(ELF_MAGIC_HEX, "hex"), "darwin"), false);
    assert.equal(
      isNativeCompiledSleeper(Buffer.from("#!/bin/sh\nsleep 120\n"), "darwin"),
      false,
    );
    assert.equal(isNativeCompiledSleeper(Buffer.alloc(0), "darwin"), false);
    assert.equal(isNativeCompiledSleeper(Buffer.from([0xcf, 0xfa]), "darwin"), false);
    assert.equal(isNativeCompiledSleeper(null, "darwin"), false);
  });
});

describe("isNativeCompiledSleeper on linux", () => {
  it("accepts the ELF header", () => {
    assert.equal(ELF_MAGIC_HEX, "7f454c46");
    assert.equal(
      isNativeCompiledSleeper(Buffer.from([0x7f, 0x45, 0x4c, 0x46]), "linux"),
      true,
    );
  });

  it("rejects Mach-O binaries, shell scripts and short input", () => {
    for (const hex of MACH_O_MAGICS) {
      assert.equal(isNativeCompiledSleeper(Buffer.from(hex, "hex"), "linux"), false, hex);
    }
    assert.equal(
      isNativeCompiledSleeper(Buffer.from("#!/bin/sh\nsleep 120\n"), "linux"),
      false,
    );
    assert.equal(isNativeCompiledSleeper(Buffer.alloc(0), "linux"), false);
    assert.equal(isNativeCompiledSleeper(undefined, "linux"), false);
  });
});

describe("compiled sleeper fixture on this platform", () => {
  // Mirrors the acceptance's own fixture step: compile the real C sleeper
  // with cc, prove the guard accepts this platform's header, and execute
  // the binary for a real exit code. This runs only the platform under
  // test — it never claims the other platform executes.
  it("compiles, passes the native guard and exits 0", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dg-622-sleeper-"));
    try {
      const source = path.join(dir, "9.9.9.c");
      const binary = path.join(dir, "9.9.9");
      await writeFile(source, TIMED_SLEEPER_C_SOURCE);
      await execFileAsync("cc", ["-O2", "-o", binary, source], { timeout: 120000 });
      await chmod(binary, 0o755);
      const magic = (await readFile(binary)).subarray(0, 4);
      assert.equal(
        isNativeCompiledSleeper(magic),
        true,
        `cc output header ${Buffer.from(magic).toString("hex")} must pass on ${process.platform}`,
      );
      const { stdout } = await execFileAsync(binary, ["0"], { timeout: 30000 });
      assert.equal(stdout, "");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("rootRowTextIsAgentNotTerminal", () => {
  it("accepts the agent label with a freshness secondary", () => {
    assert.equal(rootRowTextIsAgentNotTerminal("Claude - No update in 0mnow"), true);
  });

  it("rejects shell titles", () => {
    assert.equal(rootRowTextIsAgentNotTerminal("Terminal 1 - zsh"), false);
    assert.equal(rootRowTextIsAgentNotTerminal("Claude Terminal 1"), false);
    assert.equal(rootRowTextIsAgentNotTerminal("Claude - zsh"), false);
    assert.equal(rootRowTextIsAgentNotTerminal(""), false);
  });
});
