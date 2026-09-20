// Unit companion for scripts/accept-sidebar-agent-tree.mjs: covers the pure
// projections the acceptance run asserts through, so a silent change to
// either side breaks loudly. Never launches a daemon, an Electron app or a
// PTY.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ACCEPTANCE_RUST_BUILD,
  CHECK_NAMES,
  COLLAPSE_STORAGE_KEY,
  TIMED_SLEEPER_C_SOURCE,
  isObservedClaudeSession,
  parseCollapsedLineageEnvelope,
  projectAgentTreeRow,
  projectBinaryIdentity,
  quoteShellWord,
  rootRowTextIsAgentNotTerminal,
} from "./accept-sidebar-agent-tree.mjs";

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
