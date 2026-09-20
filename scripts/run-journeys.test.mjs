// scripts/run-journeys.test.mjs — black-box gate tests for scripts/run-journeys.mjs.
// Node builtins only. Each test builds a scratch manifest plus fixture
// journey scripts under the gitignored .preflight/ tree (entries must stay
// inside the repo root) and runs the real runner as a child process.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const runner = path.join(root, "scripts", "run-journeys.mjs");

const FIXTURES = {
  "pass.mjs": "process.exit(0);\n",
  "fail.mjs": "console.error('fixture boom');\nprocess.exit(1);\n",
  "hang.mjs": "setInterval(() => {}, 250);\n",
  "sleeper.mjs": "setInterval(() => {}, 500);\n",
  "leaker.mjs": [
    "import { spawn } from 'node:child_process';",
    "// Leak a grandchild in OUR process group (no detached flag), then exit",
    "// cleanly: the runner must still reap it before reporting PASS.",
    "const kid = spawn(process.execPath,",
    "  [new URL('./sleeper.mjs', import.meta.url), process.argv[2]],",
    "  { stdio: 'ignore' });",
    "kid.unref();",
    "process.exit(0);",
    "",
  ].join("\n"),
};

async function scratch() {
  const dir = await mkdtemp(path.join(root, ".preflight", "run-journeys-test-"));
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(FIXTURES))
    await writeFile(path.join(dir, name), content);
  return dir;
}

function relToRoot(abs) {
  return path.relative(root, abs);
}

async function writeManifest(dir, name, journeys) {
  const file = path.join(dir, name);
  await writeFile(file, JSON.stringify({ version: 1, journeys }));
  return file;
}

function entry(dir, name, script, extra = {}) {
  return {
    name,
    script: relToRoot(path.join(dir, script)),
    timeoutMs: 15000,
    note: "runner self-test fixture",
    ...extra,
  };
}

// The test process inherits the developer's (or a dispatcher's) shell: pass
// a controlled env down so prerequisite probes see exactly what the test set.
function runnerEnv(overrides = {}) {
  return { ...process.env, ...overrides };
}

async function runRunner(manifestPath, env = runnerEnv()) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [runner, "--manifest", manifestPath],
      { env, timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

async function processTable() {
  const { stdout } = await execFileAsync("/bin/ps", ["-ax", "-o", "pid=,command="]);
  return stdout;
}

test("a passing journey passes the runner", async () => {
  const dir = await scratch();
  try {
    const manifest = await writeManifest(dir, "pass.json", [
      entry(dir, "pass-fixture", "pass.mjs"),
    ]);
    const result = await runRunner(manifest);
    assert.equal(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /^PASS pass-fixture \([\d.]+s\)$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failing journey fails the runner", async () => {
  const dir = await scratch();
  try {
    const manifest = await writeManifest(dir, "fail.json", [
      entry(dir, "fail-fixture", "fail.mjs"),
    ]);
    const result = await runRunner(manifest);
    assert.equal(result.code, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /^FAIL fail-fixture \([\d.]+s\): exited with code 1$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("one result line per journey in a mixed run", async () => {
  const dir = await scratch();
  try {
    const manifest = await writeManifest(dir, "mixed.json", [
      entry(dir, "mix-pass", "pass.mjs"),
      entry(dir, "mix-fail", "fail.mjs"),
    ]);
    const result = await runRunner(manifest);
    assert.equal(result.code, 1);
    assert.equal(result.stdout.match(/^PASS mix-pass /m)?.length, 1);
    assert.equal(result.stdout.match(/^FAIL mix-fail /m)?.length, 1);
    assert.match(result.stdout, /^journeys: 1 passed, 1 failed, 0 skipped \(2 total\)$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing pi prerequisite is skipped, never passed", async () => {
  const dir = await scratch();
  try {
    const manifest = await writeManifest(dir, "skip-pi.json", [
      entry(dir, "pi-fixture", "pass.mjs", { requires: "pi" }),
    ]);
    const emptyBin = await mkdtemp(path.join(tmpdir(), "drogon-nopi-"));
    try {
      const result = await runRunner(
        manifest,
        runnerEnv({ PATH: emptyBin }),
      );
      assert.equal(
        result.code,
        1,
        `all-skipped must exit non-zero, stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
      assert.match(result.stdout, /^SKIP pi-fixture: pi harness absent from PATH$/m);
      assert.doesNotMatch(result.stdout, /^PASS /m);
      assert.match(result.stdout, /^journeys: 0 passed, 0 failed, 1 skipped \(1 total\)$/m);
    } finally {
      await rm(emptyBin, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing bundle prerequisite is skipped, never passed", async () => {
  const dir = await scratch();
  try {
    const manifest = await writeManifest(dir, "skip-bundle.json", [
      entry(dir, "bundle-fixture", "pass.mjs", { requires: "bundle" }),
    ]);
    const result = await runRunner(
      manifest,
      runnerEnv({ DROGON_BUNDLE: path.join(dir, "does-not-exist.app") }),
    );
    assert.equal(result.code, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /^SKIP bundle-fixture: packaged bundle absent/m);
    assert.doesNotMatch(result.stdout, /^PASS /m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an empty manifest exits non-zero instead of reporting success", async () => {
  const dir = await scratch();
  try {
    const manifest = await writeManifest(dir, "empty.json", []);
    const result = await runRunner(manifest);
    assert.notEqual(result.code, 0, `stdout:\n${result.stdout}`);
    assert.match(result.stderr, /zero journeys/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing manifest exits non-zero", async () => {
  const result = await runRunner(path.join(tmpdir(), "drogon-no-such-manifest.json"));
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /manifest missing/);
});

test("an unparseable manifest exits non-zero", async () => {
  const dir = await scratch();
  try {
    const file = path.join(dir, "broken.json");
    await writeFile(file, "{ this is not json");
    const result = await runRunner(file);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /unparseable manifest/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a hung journey hits its timeout and is reported as a failure", async () => {
  const dir = await scratch();
  try {
    const manifest = await writeManifest(dir, "hang.json", [
      entry(dir, "hang-fixture", "hang.mjs", { timeoutMs: 1500 }),
    ]);
    const result = await runRunner(manifest);
    assert.equal(
      result.code,
      1,
      `timeout must fail, stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.match(result.stdout, /^FAIL hang-fixture \([\d.]+s\): timeout after 1500ms/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the runner leaves no child process behind", async () => {
  const dir = await scratch();
  const token = `drogon-sleeper-${process.pid}-${Date.now()}`;
  try {
    const manifest = await writeManifest(dir, "leak.json", [
      entry(dir, "leak-fixture", "leaker.mjs", { args: [token] }),
    ]);
    const result = await runRunner(manifest);
    assert.equal(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /^PASS leak-fixture /m);
    // The leaked grandchild carried the token in its argv; prove it is gone.
    // Poll briefly: SIGKILL delivery plus ps visibility can lag the exit.
    let survivor = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const table = await processTable();
      survivor = table
        .split("\n")
        .filter((line) => line.includes(token))
        .join("\n");
      if (!survivor) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(survivor, "", `leaked processes survived the run:\n${survivor}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
