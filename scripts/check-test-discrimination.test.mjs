import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  codeLayerOf,
  commandForTests,
  decideExit,
  hunkInRustTest,
  importsFile,
  isTestFile,
  parseUnifiedDiff,
  rustTestLineRanges,
  singleHunkPatch,
  testsForSource,
} from "./check-test-discrimination.mjs";

const GATE = fileURLToPath(new URL("./check-test-discrimination.mjs", import.meta.url));
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "gate-fixture",
  GIT_AUTHOR_EMAIL: "gate-fixture@example.com",
  GIT_COMMITTER_NAME: "gate-fixture",
  GIT_COMMITTER_EMAIL: "gate-fixture@example.com",
};

function git(dir, ...args) {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: GIT_ENV, timeout: 30000 });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), "disc-gate-"));
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "gate-fixture@example.com");
  git(dir, "config", "user.name", "gate-fixture");
  git(dir, "config", "commit.gpgsign", "false");
  return dir;
}

function commitAll(dir, message) {
  git(dir, "add", "-A");
  git(dir, "commit", "-m", message, "--quiet");
  return git(dir, "rev-parse", "HEAD");
}

function runGate(dir, ...args) {
  return spawnSync(process.execPath, [GATE, ...args], { cwd: dir, encoding: "utf8", env: process.env, timeout: 120000 });
}

function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
}

function treeState(dir) {
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8", timeout: 30000 });
  assert.equal(status.status, 0);
  return status.stdout;
}

const ADD_BASE = "export function add(a, b) {\n  return a + b;\n}\n";
const ADD_CHANGED = "export function add(a, b) {\n  return a + b + 1;\n}\n";
const WEAK_TEST = (name) =>
  `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "./add.mjs";\ntest(${JSON.stringify(name)}, () => {\n  assert.equal(typeof add(1, 2), "number");\n});\n`;
const PINNING_TEST = `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "./add.mjs";\ntest("add adds one extra", () => {\n  assert.equal(add(1, 2), 4);\n});\n`;

test("isTestFile matches the three test shapes and nothing else", () => {
  for (const p of ["a.test.mjs", "src/a.test.ts", "tests/foo.mjs", "tests/deep/bar.ts", "scripts/x.test.mjs"]) {
    assert.equal(isTestFile(p), true, p);
  }
  for (const p of ["src/foo.mjs", "scripts/tool.mjs", "contest.mjs", "src/testing.mjs", "test.mjs", "README.md"]) {
    assert.equal(isTestFile(p), false, p);
  }
});

test("codeLayerOf separates rust, js, and other layers", () => {
  assert.equal(codeLayerOf("crates/x/src/lib.rs"), "rust");
  for (const p of ["a.mjs", "b.ts", "c.tsx", "d.jsx", "e.cjs", "f.mts", "g.js", "h.cts"]) {
    assert.equal(codeLayerOf(`src/${p}`), "js", p);
  }
  for (const p of ["package.json", "docs/a.md", ".github/workflows/f.yml", "Makefile"]) {
    assert.equal(codeLayerOf(p), "other", p);
  }
});

test("parseUnifiedDiff splits files and hunks, including new files", () => {
  const diff = [
    "diff --git a/scripts/a.mjs b/scripts/a.mjs",
    "index 1111111..2222222 100644",
    "--- a/scripts/a.mjs",
    "+++ b/scripts/a.mjs",
    "@@ -1,2 +1,2 @@",
    " ctx",
    "-old",
    "+new",
    "@@ -9,1 +9,1 @@",
    "-x",
    "+y",
    "diff --git a/scripts/new.mjs b/scripts/new.mjs",
    "new file mode 100644",
    "index 0000000..3333333",
    "--- /dev/null",
    "+++ b/scripts/new.mjs",
    "@@ -0,0 +1,2 @@",
    "+one",
    "+two",
  ].join("\n");
  const hunks = parseUnifiedDiff(diff);
  assert.equal(hunks.length, 3);
  assert.equal(hunks[0].file, "scripts/a.mjs");
  assert.equal(hunks[0].newStart, 1);
  assert.equal(hunks[0].body.join("\n"), " ctx\n-old\n+new");
  assert.equal(hunks[1].header, "@@ -9,1 +9,1 @@");
  assert.equal(hunks[2].file, "scripts/new.mjs");
  const patch = singleHunkPatch(hunks[0]);
  assert.match(patch, /^--- a\/scripts\/a\.mjs$/m);
  assert.match(patch, /^\+\+\+ b\/scripts\/a\.mjs$/m);
  assert.match(patch, /^@@ -1,2 \+1,2 @@$/m);
});

test("rust cfg(test) regions classify hunks inside versus outside", () => {
  const src = [
    "pub fn double(n: i32) -> i32 {",
    "    n * 2",
    "}",
    "",
    "#[cfg(test)]",
    "mod tests {",
    "    use super::*;",
    "    #[test]",
    "    fn doubles() {",
    "        assert_eq!(double(2), 4);",
    "    }",
    "}",
    "",
  ].join("\n");
  const ranges = rustTestLineRanges(src);
  assert.equal(ranges.length, 1);
  assert.deepEqual(ranges[0], [5, 12]);
  assert.equal(hunkInRustTest(src, 9, 2), true);
  assert.equal(hunkInRustTest(src, 2, 1), false);
  assert.equal(hunkInRustTest(src, 4, 4), false);
  assert.equal(hunkInRustTest(src, 3, 0), false);
});

test("testsForSource maps by stem and by import, and ignores the rest", () => {
  const files = {
    "scripts/tool.test.mjs": `import { run } from "./tool.mjs";`,
    "scripts/other.test.mjs": `import test from "node:test";`,
    "apps/desktop/src/preload/guard.ts": `export const x = 1;`,
  };
  const read = (p) => files[p];
  assert.deepEqual(testsForSource("scripts/tool.mjs", ["scripts/tool.test.mjs", "scripts/other.test.mjs"], read), [
    "scripts/tool.test.mjs",
  ]);
  assert.deepEqual(
    testsForSource("apps/desktop/src/preload/guard.ts", ["tests/parity/guard.test.ts"], (p) =>
      p === "tests/parity/guard.test.ts" ? `import { x } from "../../apps/desktop/src/preload/guard";` : null,
    ),
    ["tests/parity/guard.test.ts"],
  );
  assert.equal(importsFile(`const g = require("../other/thing");`, "tests/parity", "tests/src/preload/guard"), false);
  assert.equal(importsFile(`import "vitest";`, "tests/parity", "apps/desktop/src/preload/guard.ts"), false);
});

test("commandForTests sends scripts tests to node and the rest to vitest", () => {
  const cmds = commandForTests("/node", "/v/vitest.mjs", ["scripts/a.test.mjs", "tests/b.test.ts"]);
  assert.equal(cmds.length, 2);
  assert.equal(cmds[0].kind, "node");
  assert.deepEqual(cmds[0].argv, ["/node", "--test", "scripts/a.test.mjs"]);
  assert.equal(cmds[1].kind, "vitest");
  assert.deepEqual(cmds[1].argv, ["/node", "/v/vitest.mjs", "run", "tests/b.test.ts"]);
  assert.equal(commandForTests("/node", "/v", ["scripts/a.test.mjs"]).length, 1);
});

test("decideExit: pinned-only passes, UNPINNED/no-tests fail, timeout is infra", () => {
  assert.equal(decideExit([{ verdict: "pinned" }, { verdict: "UNVERIFIED-rust" }, { verdict: "UNVERIFIED-scope" }]), 0);
  assert.equal(decideExit([]), 0);
  assert.equal(decideExit([{ verdict: "pinned" }, { verdict: "UNPINNED" }]), 1);
  assert.equal(decideExit([{ verdict: "no-tests" }]), 1);
  assert.equal(decideExit([{ verdict: "UNPINNED" }, { verdict: "timeout" }]), 2);
  assert.equal(decideExit([{ verdict: "infra" }]), 2);
});

test("(a) a decorative test is UNPINNED and exits 1", () => {
  const dir = initRepo();
  try {
    writeFiles(dir, { "scripts/add.mjs": ADD_BASE, "scripts/add.test.mjs": WEAK_TEST("add returns a number") });
    const base = commitAll(dir, "base");
    writeFiles(dir, { "scripts/add.mjs": ADD_CHANGED, "scripts/add.test.mjs": WEAK_TEST("add still returns a number") });
    commitAll(dir, "decorative change");
    const beforeSource = readFileSync(join(dir, "scripts/add.mjs"), "utf8");
    const beforeTest = readFileSync(join(dir, "scripts/add.test.mjs"), "utf8");
    const run = runGate(dir, "--base", base);
    assert.equal(run.status, 1, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.match(run.stdout, /UNPINNED/);
    assert.match(run.stdout, /RESULT: FAIL/);
    assert.match(run.stdout, /sha256 before [0-9a-f]{64} after [0-9a-f]{64}/);
    const asJson = runGate(dir, "--base", base, "--json");
    assert.equal(asJson.status, 1);
    const report = JSON.parse(asJson.stdout);
    assert.equal(report.hunks[0].verdict, "UNPINNED");
    assert.equal(report.hunks[0].shaBefore, report.hunks[0].shaAfter);
    assert.equal(treeState(dir), "");
    assert.equal(readFileSync(join(dir, "scripts/add.mjs"), "utf8"), beforeSource);
    assert.equal(readFileSync(join(dir, "scripts/add.test.mjs"), "utf8"), beforeTest);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(b) a discriminating test is pinned and exits 0", () => {
  const dir = initRepo();
  try {
    writeFiles(dir, { "scripts/add.mjs": ADD_BASE });
    const base = commitAll(dir, "base");
    writeFiles(dir, { "scripts/add.mjs": ADD_CHANGED, "scripts/add.test.mjs": PINNING_TEST });
    commitAll(dir, "pinned change");
    const beforeSource = readFileSync(join(dir, "scripts/add.mjs"), "utf8");
    const run = runGate(dir, "--base", base);
    assert.equal(run.status, 0, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.match(run.stdout, /^pinned /m);
    assert.match(run.stdout, /RESULT: PASS/);
    assert.doesNotMatch(run.stdout, /^UNPINNED /m);
    assert.equal(treeState(dir), "");
    assert.equal(readFileSync(join(dir, "scripts/add.mjs"), "utf8"), beforeSource);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(c) the tree is restored byte-identically after every hunk", () => {
  const dir = initRepo();
  try {
    writeFiles(dir, { "scripts/add.mjs": ADD_BASE, "scripts/add.test.mjs": WEAK_TEST("weak") });
    const base = commitAll(dir, "base");
    writeFiles(dir, { "scripts/add.mjs": ADD_CHANGED, "scripts/add.test.mjs": WEAK_TEST("weak v2") });
    commitAll(dir, "change");
    const snapshot = {
      "scripts/add.mjs": readFileSync(join(dir, "scripts/add.mjs")),
      "scripts/add.test.mjs": readFileSync(join(dir, "scripts/add.test.mjs")),
    };
    const run = runGate(dir, "--base", base, "--json");
    assert.equal(run.status, 1);
    const report = JSON.parse(run.stdout);
    for (const hunk of report.hunks) {
      if (hunk.shaBefore) assert.equal(hunk.shaBefore, hunk.shaAfter, hunk.file);
    }
    assert.equal(treeState(dir), "");
    for (const [rel, bytes] of Object.entries(snapshot)) {
      assert.deepEqual(readFileSync(join(dir, rel)), bytes, rel);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(c2) restore preserves the executable bit on reverted files", () => {
  // Reverting a new file's whole-file hunk deletes it, so a bytes-only
  // restore recreates it without the executable bit and leaves the tree dirty.
  const dir = initRepo();
  try {
    writeFiles(dir, { "placeholder.txt": "base\n" });
    const base = commitAll(dir, "base");
    writeFiles(dir, {
      "scripts/tool.mjs": "export const v = 2;\n",
      "scripts/tool.test.mjs": `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { v } from "./tool.mjs";\ntest("v", () => {\n  assert.equal(v, 2);\n});\n`,
    });
    chmodSync(join(dir, "scripts/tool.mjs"), 0o755);
    commitAll(dir, "change");
    const run = runGate(dir, "--base", base);
    assert.equal(run.status, 0, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.match(run.stdout, /^pinned /m);
    assert.equal(statSync(join(dir, "scripts/tool.mjs")).mode & 0o777, 0o755);
    assert.equal(treeState(dir), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(d) a dirty working tree is refused with a non-zero exit", () => {
  const dir = initRepo();
  try {
    writeFiles(dir, { "scripts/add.mjs": ADD_BASE, "scripts/add.test.mjs": WEAK_TEST("weak") });
    const base = commitAll(dir, "base");
    writeFiles(dir, { "scripts/add.mjs": ADD_CHANGED });
    const run = runGate(dir, "--base", base);
    assert.notEqual(run.status, 0);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /dirty/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(e) source changed with no test change fails with a clear reason", () => {
  const dir = initRepo();
  try {
    writeFiles(dir, { "scripts/add.mjs": ADD_BASE });
    const base = commitAll(dir, "base");
    writeFiles(dir, { "scripts/add.mjs": ADD_CHANGED });
    commitAll(dir, "untested change");
    const run = runGate(dir, "--base", base);
    assert.equal(run.status, 1, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.match(run.stdout, /no-tests/);
    assert.match(run.stdout, /RESULT: FAIL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(e2) a large inherited diff is still tested instead of aborting with ENOBUFS", () => {
  const dir = initRepo();
  try {
    writeFiles(dir, { "README.md": "base\n" });
    const base = commitAll(dir, "base");
    const largeSource = [
      "export const fixture = [",
      ...Array.from({ length: 200_000 }, (_, index) => `  ${index},`),
      "];",
      "",
    ].join("\n");
    writeFiles(dir, { "scripts/large.mjs": largeSource });
    commitAll(dir, "large source change");
    const run = runGate(dir, "--base", base, "--json");
    assert.equal(run.status, 1, `stdout:\n${run.stdout.slice(0, 1000)}\nstderr:\n${run.stderr}`);
    assert.doesNotMatch(run.stderr, /ENOBUFS/);
    const report = JSON.parse(run.stdout);
    assert.equal(report.hunks.length, 1);
    assert.equal(report.hunks[0].file, "scripts/large.mjs");
    assert.equal(report.hunks[0].verdict, "no-tests");
    assert.equal(treeState(dir), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(f) infrastructure failure exits 2, never 0", () => {
  const dir = initRepo();
  try {
    writeFiles(dir, { "scripts/add.mjs": ADD_BASE });
    commitAll(dir, "base");
    const run = runGate(dir, "--base", "refs/heads/does-not-exist");
    assert.equal(run.status, 2, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /unknown base ref/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(g) an untracked .drogon/ directory does not block the gate and is named in the report", () => {
  const dir = initRepo();
  try {
    writeFiles(dir, { "scripts/add.mjs": ADD_BASE });
    const base = commitAll(dir, "base");
    writeFiles(dir, { "scripts/add.mjs": ADD_CHANGED, "scripts/add.test.mjs": PINNING_TEST });
    commitAll(dir, "pinned change");
    writeFiles(dir, { ".drogon/session.json": `{"run":"fixture"}\n` });
    const run = runGate(dir, "--base", base);
    assert.equal(run.status, 0, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.match(run.stdout, /RESULT: PASS/);
    assert.match(run.stdout, /\.drogon\//);
    assert.match(run.stdout, /ignoring .* untracked/);
    const asJson = runGate(dir, "--base", base, "--json");
    assert.equal(asJson.status, 0, `stdout:\n${asJson.stdout}\nstderr:\n${asJson.stderr}`);
    const report = JSON.parse(asJson.stdout);
    assert.ok(
      report.untrackedIgnored.some((p) => p.includes(".drogon/")),
      `untrackedIgnored should name the .drogon path: ${JSON.stringify(report.untrackedIgnored)}`,
    );
    // Ignored means left alone: the untracked directory survives the run.
    assert.match(treeState(dir), /\.drogon\//);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(h) an unstaged modification to a tracked file refuses with exit 2", () => {
  const dir = initRepo();
  try {
    writeFiles(dir, { "scripts/add.mjs": ADD_BASE, "scripts/add.test.mjs": WEAK_TEST("weak") });
    const base = commitAll(dir, "base");
    writeFiles(dir, { "scripts/add.mjs": ADD_CHANGED });
    const run = runGate(dir, "--base", base);
    assert.equal(run.status, 2, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.match(run.stderr, /refusing/);
    assert.match(run.stderr, /dirty/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(i) a staged modification to a tracked file refuses with exit 2", () => {
  const dir = initRepo();
  try {
    writeFiles(dir, { "scripts/add.mjs": ADD_BASE, "scripts/add.test.mjs": WEAK_TEST("weak") });
    const base = commitAll(dir, "base");
    writeFiles(dir, { "scripts/add.mjs": ADD_CHANGED });
    git(dir, "add", "scripts/add.mjs");
    const run = runGate(dir, "--base", base);
    assert.equal(run.status, 2, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.match(run.stderr, /refusing/);
    assert.match(run.stderr, /dirty/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(j) an unmerged conflict entry refuses with exit 2", () => {
  const dir = initRepo();
  try {
    writeFiles(dir, { "conflict.txt": "base\n", "scripts/add.mjs": ADD_BASE });
    const base = commitAll(dir, "base");
    git(dir, "checkout", "-b", "side", "--quiet");
    writeFiles(dir, { "conflict.txt": "side\n" });
    commitAll(dir, "side change");
    git(dir, "checkout", "main", "--quiet");
    writeFiles(dir, { "conflict.txt": "main\n" });
    commitAll(dir, "main change");
    const merge = spawnSync("git", ["merge", "side"], { cwd: dir, encoding: "utf8", env: GIT_ENV, timeout: 30000 });
    assert.notEqual(merge.status, 0, "fixture should produce a merge conflict");
    assert.match(treeState(dir), /^UU conflict\.txt/m);
    const run = runGate(dir, "--base", base);
    assert.equal(run.status, 2, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.match(run.stderr, /refusing/);
    assert.match(run.stderr, /dirty/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rust and non-code hunks are reported as unverified, never silently passed", () => {
  const dir = initRepo();
  try {
    writeFiles(dir, {
      "crates/demo/src/lib.rs": "pub fn f() -> i32 {\n    1\n}\n",
      "notes.md": "# hi\n",
      "scripts/add.mjs": ADD_BASE,
    });
    const base = commitAll(dir, "base");
    writeFiles(dir, {
      "crates/demo/src/lib.rs": "pub fn f() -> i32 {\n    2\n}\n",
      "notes.md": "# hi!\n",
      "scripts/add.mjs": ADD_CHANGED,
      "scripts/add.test.mjs": PINNING_TEST,
    });
    commitAll(dir, "mixed change");
    const run = runGate(dir, "--base", base, "--json");
    assert.equal(run.status, 0, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    const report = JSON.parse(run.stdout);
    const byFile = Object.fromEntries(report.hunks.map((h) => [h.file, h.verdict]));
    assert.equal(byFile["crates/demo/src/lib.rs"], "UNVERIFIED-rust");
    assert.equal(byFile["notes.md"], "UNVERIFIED-scope");
    assert.equal(byFile["scripts/add.mjs"], "pinned");
    assert.match(JSON.stringify(report.scopeNote), /never a pass/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
