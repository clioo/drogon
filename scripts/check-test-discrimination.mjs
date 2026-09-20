#!/usr/bin/env node
// Test-discrimination gate: for each source hunk in <base>...HEAD, revert
// exactly that hunk, run the changed tests mapped to it, and require that at
// least one of them fails. Usage:
//   node scripts/check-test-discrimination.mjs [--base <ref>] [--json] [--timeout-ms <ms>]
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const SCHEMA = "drogon.test-discrimination/1";
export const DEFAULT_TIMEOUT_MS = 180000;
export const JS_EXTS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".jsx"]);
const IMPORT_EXTS = ["", ".mjs", ".js", ".mts", ".ts", ".tsx", ".jsx", ".cjs", ".cts"];

const activeChildren = new Set();
let activeRestore = null;

process.on("SIGINT", () => {
  try {
    activeRestore?.();
  } finally {
    process.exit(130);
  }
});
process.on("SIGTERM", () => {
  try {
    activeRestore?.();
  } finally {
    process.exit(143);
  }
});

export function isTestFile(path) {
  const normalized = path.replace(/\\/g, "/");
  if (normalized === "tests" || normalized.startsWith("tests/")) return true;
  if (/(^|\/)[^/]*\.test\.[^/]+$/.test(normalized)) return true;
  if (/^scripts\/[^/]+\.test\.mjs$/.test(normalized)) return true;
  return false;
}

export function codeLayerOf(path) {
  const normalized = path.replace(/\\/g, "/");
  const dot = normalized.lastIndexOf(".");
  const ext = dot === -1 ? "" : normalized.slice(dot).toLowerCase();
  if (ext === ".rs") return "rust";
  if (JS_EXTS.has(ext)) return "js";
  return "other";
}

export function parseUnifiedDiff(diffText) {
  const hunks = [];
  let file = null;
  let headerLines = [];
  let current = null;
  const flush = () => {
    if (current) {
      hunks.push(current);
      current = null;
    }
  };
  for (const rawLine of diffText.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("diff --git ")) {
      flush();
      file = null;
      headerLines = [];
      continue;
    }
    if (file === null) {
      if (line.startsWith("--- ")) {
        const oldPath = line.slice(4).trim();
        headerLines.push(line);
        continue;
      }
      if (line.startsWith("+++ ")) {
        const newPath = line.slice(4).trim();
        headerLines.push(line);
        if (newPath !== "/dev/null") {
          file = newPath.startsWith("b/") ? newPath.slice(2) : newPath;
        } else {
          const oldPath = headerLines.length >= 2 ? headerLines[headerLines.length - 2].slice(4).trim() : "";
          file = oldPath.startsWith("a/") ? oldPath.slice(2) : oldPath;
        }
        continue;
      }
      if (
        line.startsWith("new file mode") ||
        line.startsWith("deleted file mode") ||
        line.startsWith("old mode") ||
        line.startsWith("new mode") ||
        line.startsWith("index ") ||
        line.startsWith("similarity ") ||
        line.startsWith("rename ")
      ) {
        headerLines.push(line);
        continue;
      }
    }
    const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunkMatch && file !== null) {
      flush();
      current = {
        file,
        header: line,
        oldStart: Number(hunkMatch[1]),
        oldLen: hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]),
        newStart: Number(hunkMatch[3]),
        newLen: hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]),
        preamble: [...headerLines],
        body: [],
      };
      continue;
    }
    if (current) current.body.push(line);
  }
  flush();
  return hunks.filter((hunk) => hunk.file !== null && hunk.file !== "");
}

export function singleHunkPatch(hunk) {
  return [...hunk.preamble, hunk.header, ...hunk.body].join("\n") + "\n";
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function maskRustNoise(text) {
  return text
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => " ".repeat(m.length))
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => " ".repeat(m.length))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

export function rustTestLineRanges(text) {
  const masked = maskRustNoise(text);
  const ranges = [];
  const re = /#\[cfg\(test\)\]\s*mod\s+[A-Za-z0-9_]+\s*\{/g;
  let match;
  while ((match = re.exec(masked)) !== null) {
    const openIdx = match.index + match[0].lastIndexOf("{");
    let depth = 0;
    let closeIdx = -1;
    for (let i = openIdx; i < masked.length; i += 1) {
      if (masked[i] === "{") depth += 1;
      else if (masked[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }
    const startLine = lineOf(text, match.index);
    const endLine = closeIdx === -1 ? lineOf(text, text.length) : lineOf(text, closeIdx);
    ranges.push([startLine, endLine]);
  }
  return ranges;
}

export function hunkInRustTest(text, newStart, newLen) {
  if (newLen === 0) return false;
  const end = newStart + newLen - 1;
  return rustTestLineRanges(text).some(([start, stop]) => newStart >= start && end <= stop);
}

function stemOf(path) {
  const base = path.replace(/\\/g, "/").split("/").pop();
  const testMatch = /^(.*)\.test\.[^.]+$/.exec(base);
  if (testMatch) return testMatch[1];
  const dot = base.lastIndexOf(".");
  return dot === -1 ? base : base.slice(0, dot);
}

function specMatchesSource(testDir, spec, sourceFile) {
  if (!spec.startsWith(".")) return false;
  const target = normalize(join(testDir, spec)).replace(/\\/g, "/");
  const source = sourceFile.replace(/\\/g, "/");
  if (target === source) return true;
  for (const ext of IMPORT_EXTS) {
    if (target + ext === source) return true;
    if (target === source + ext) return true;
  }
  for (const ext of IMPORT_EXTS.slice(1)) {
    if (`${target}/index${ext}` === source) return true;
  }
  return false;
}

export function importsFile(text, testDir, sourceFile) {
  const specs = new Set();
  const patterns = [/from\s+['"]([^'"]+)['"]/g, /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /import\s+['"]([^'"]+)['"]/g];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) specs.add(match[1]);
  }
  for (const spec of specs) {
    if (specMatchesSource(testDir, spec, sourceFile)) return true;
  }
  return false;
}

export function testsForSource(sourceFile, changedTestFiles, readText) {
  const sourceStem = stemOf(sourceFile);
  const out = [];
  for (const testFile of changedTestFiles) {
    if (stemOf(testFile) === sourceStem) {
      out.push(testFile);
      continue;
    }
    let text = null;
    try {
      text = readText(testFile);
    } catch {
      text = null;
    }
    if (typeof text === "string" && importsFile(text, dirname(testFile), sourceFile)) {
      out.push(testFile);
    }
  }
  return out;
}

export function commandForTests(nodePath, vitestPath, files) {
  const commands = [];
  const scriptTests = files.filter((f) => f.replace(/\\/g, "/").startsWith("scripts/"));
  const rendererTests = files.filter((f) => !f.replace(/\\/g, "/").startsWith("scripts/"));
  if (scriptTests.length > 0) commands.push({ kind: "node", argv: [nodePath, "--test", ...scriptTests] });
  if (rendererTests.length > 0) commands.push({ kind: "vitest", argv: [nodePath, vitestPath, "run", ...rendererTests] });
  return commands;
}

export function decideExit(records) {
  if (records.some((r) => r.verdict === "timeout" || r.verdict === "infra")) return 2;
  if (records.some((r) => r.verdict === "UNPINNED" || r.verdict === "no-tests")) return 1;
  return 0;
}

// Porcelain v1 dirtiness rule: the gate only ever reverts and restores
// TRACKED files, so only tracked changes can corrupt a run. Untracked paths
// (`??`) never block; they are reported as ignored instead.
export function isUntrackedPorcelainLine(line) {
  return line.startsWith("??");
}

export function splitPorcelainLines(output) {
  const lines = output.split("\n").filter((l) => l.trim() !== "");
  return {
    tracked: lines.filter((l) => !isUntrackedPorcelainLine(l)),
    untracked: lines.filter((l) => isUntrackedPorcelainLine(l)),
  };
}

export function untrackedPathOf(line) {
  const rest = line.slice(2).trimStart();
  if (rest.length >= 2 && rest.startsWith('"') && rest.endsWith('"')) {
    try {
      return JSON.parse(rest);
    } catch {
      // Fall through to the raw remainder.
    }
  }
  return rest;
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitSync(root, args, timeoutMs = 30000) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: timeoutMs });
  return {
    ok: result.status === 0,
    code: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    error: result.error ? String(result.error?.message ?? result.error) : null,
  };
}

function childEnv() {
  // A nested `node --test` started inside a test-runner context skips running
  // any files and exits 0, which would read as "tests passed". Scrub the
  // runner markers so the inner run really executes.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return env;
}

function runCommand(argv, cwd, timeoutMs) {
  return new Promise((done) => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv(),
      });
    } catch (error) {
      done({ code: null, signal: null, stdout: "", stderr: String(error?.message ?? error), timedOut: false, spawnError: true });
      return;
    }
    activeChildren.add(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const killGroup = (signal) => {
      try {
        if (child.pid !== undefined && process.platform !== "win32") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // Already exited.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      const force = setTimeout(() => killGroup("SIGKILL"), 5000);
      if (typeof force.unref === "function") force.unref();
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      done({ code: null, signal: null, stdout, stderr: stderr + String(error?.message ?? error), timedOut, spawnError: true });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      done({ code, signal, stdout, stderr, timedOut, spawnError: false });
    });
  });
}

function changedFiles(root, base) {
  const result = gitSync(root, ["diff", "--name-status", "-z", `${base}...HEAD`, "--"]);
  if (!result.ok) throw new Error(`git diff --name-status failed: ${result.stderr.trim() || result.error || `exit ${result.code}`}`);
  const parts = result.stdout.split("\0").filter((p) => p !== "");
  const changedTests = [];
  const renamed = new Map();
  for (let i = 0; i < parts.length; i += 1) {
    const status = parts[i];
    if (status.startsWith("R")) {
      const from = parts[i + 1];
      const to = parts[i + 2];
      i += 2;
      renamed.set(from, to);
      if (isTestFile(to)) changedTests.push(to);
    } else {
      const path = parts[i + 1];
      i += 1;
      const code = status[0];
      if ((code === "A" || code === "M") && isTestFile(path)) changedTests.push(path);
    }
  }
  return { changedTests, renamed };
}

function showFile(root, rev, path) {
  const result = gitSync(root, ["show", `${rev}:${path}`]);
  return result.ok ? result.stdout : null;
}

function usage() {
  return [
    "Usage: node scripts/check-test-discrimination.mjs [--base <ref>] [--json] [--timeout-ms <ms>]",
    "",
    "Reverts each source hunk in <base>...HEAD one at a time, runs the changed",
    "tests mapped to it, and requires at least one of them to fail.",
    "Exit 0: every source hunk pinned. Exit 1: an UNPINNED or no-tests hunk.",
    "Exit 2: infrastructure failure (dirty tree, bad ref, restore mismatch, timeout).",
  ].join("\n");
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        base: { type: "string", default: "origin/main" },
        json: { type: "boolean", default: false },
        "timeout-ms": { type: "string", default: String(DEFAULT_TIMEOUT_MS) },
        help: { type: "boolean", default: false },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(`discrimination gate: bad arguments: ${error.message}\n${usage()}`);
    return 2;
  }
  if (values.help) {
    console.log(usage());
    return 0;
  }
  const base = values.base;
  const timeoutMs = Number(values["timeout-ms"]);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.error("discrimination gate: --timeout-ms must be a positive number of milliseconds.");
    return 2;
  }

  const here = gitSync(process.cwd(), ["rev-parse", "--show-toplevel"]);
  if (!here.ok) {
    console.error("discrimination gate: not inside a git repository; cannot diff safely.");
    return 2;
  }
  const root = here.stdout.trim();

  const dirty = gitSync(root, ["status", "--porcelain"]);
  if (!dirty.ok) {
    console.error(`discrimination gate: could not inspect the working tree: ${dirty.stderr.trim() || dirty.error}.`);
    return 2;
  }
  const { tracked: trackedDirty, untracked: untrackedPresent } = splitPorcelainLines(dirty.stdout);
  const untrackedIgnored = untrackedPresent.map(untrackedPathOf);
  if (trackedDirty.length > 0) {
    console.error(
      `discrimination gate: refusing to run on a dirty working tree (${trackedDirty.length} tracked changed path(s)); commit or stash first, then re-run.`,
    );
    for (const line of trackedDirty.slice(0, 10)) console.error(`  ${line}`);
    return 2;
  }

  const verify = gitSync(root, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  if (!verify.ok) {
    console.error(`discrimination gate: unknown base ref ${JSON.stringify(base)}; fetch it first (e.g. git fetch origin main).`);
    return 2;
  }

  let changedTests;
  try {
    ({ changedTests } = changedFiles(root, base));
  } catch (error) {
    console.error(`discrimination gate: ${error.message}`);
    return 2;
  }

  const diffResult = gitSync(root, ["diff", "-U3", "--no-color", "--no-ext-diff", `${base}...HEAD`, "--"]);
  if (!diffResult.ok) {
    console.error(`discrimination gate: git diff failed: ${diffResult.stderr.trim() || diffResult.error}.`);
    return 2;
  }
  const hunks = parseUnifiedDiff(diffResult.stdout);

  const records = [];
  let testHunksSkipped = 0;
  let infraFailure = null;

  for (const hunk of hunks) {
    if (isTestFile(hunk.file)) {
      testHunksSkipped += 1;
      continue;
    }
    const layer = codeLayerOf(hunk.file);
    if (layer === "rust") {
      const headText = showFile(root, "HEAD", hunk.file) ?? showFile(root, base, hunk.file);
      if (headText !== null && hunkInRustTest(headText, hunk.newStart, hunk.newLen)) {
        testHunksSkipped += 1;
        continue;
      }
      records.push({
        file: hunk.file,
        hunk: hunk.header,
        verdict: "UNVERIFIED-rust",
        reason: "per-hunk cargo test is out of the v1 CI budget; Rust hunks are reported, never silently passed",
        tests: [],
      });
      continue;
    }
    if (layer !== "js") {
      records.push({
        file: hunk.file,
        hunk: hunk.header,
        verdict: "UNVERIFIED-scope",
        reason: "non-code layer is out of v1 scope (JS/TS/mjs only); reported, never silently passed",
        tests: [],
      });
      continue;
    }
    const mapped = testsForSource(hunk.file, changedTests, (p) => {
      const abs = join(root, p);
      return readFileSync(abs, "utf8");
    });
    if (mapped.length === 0) {
      records.push({
        file: hunk.file,
        hunk: hunk.header,
        verdict: "no-tests",
        reason: "no changed test exercises this hunk (import, stem, or directory match); untested source change",
        tests: [],
      });
      continue;
    }
    const result = await checkHunk(root, hunk, mapped, timeoutMs);
    if (result.infra) {
      records.push(result.record);
      infraFailure = result.infra;
      break;
    }
    records.push(result.record);
  }

  const statusResult = gitSync(root, ["status", "--porcelain"]);
  const trackedAfter = statusResult.ok ? splitPorcelainLines(statusResult.stdout).tracked : null;
  if (!statusResult.ok || trackedAfter === null || trackedAfter.length > 0) {
    console.error("discrimination gate: working tree is not clean after the run; refusing to report success.");
    return 2;
  }

  const counts = {
    pinned: records.filter((r) => r.verdict === "pinned").length,
    unpinned: records.filter((r) => r.verdict === "UNPINNED").length,
    noTests: records.filter((r) => r.verdict === "no-tests").length,
    unverifiedRust: records.filter((r) => r.verdict === "UNVERIFIED-rust").length,
    unverifiedScope: records.filter((r) => r.verdict === "UNVERIFIED-scope").length,
    timeouts: records.filter((r) => r.verdict === "timeout").length,
  };
  const scopeNote =
    "JS/TS/mjs layers are fully checked (node --test for scripts tests, vitest for renderer tests). " +
    "Rust hunks are UNVERIFIED-rust: a per-hunk cargo test would blow the CI budget. " +
    "Non-code files are UNVERIFIED-scope. A skip is never a pass.";
  const exitCode = infraFailure !== null ? 2 : decideExit(records);
  const outcome = exitCode === 0 ? "PASS" : "FAIL";

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          schema: SCHEMA,
          base,
          sourceHunks: hunks.length - testHunksSkipped,
          testHunksSkipped,
          hunks: records,
          counts,
          scopeNote,
          untrackedIgnored,
          exitCode,
          outcome,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`discrimination gate: base ${base}, ${records.length} source-hunk verdict(s), ${testHunksSkipped} test hunk(s) skipped`);
    if (untrackedIgnored.length > 0) {
      console.log(
        `note: ignoring ${untrackedIgnored.length} untracked path(s) present at start (not tracked, not reverted): ${untrackedIgnored.join(", ")}`,
      );
    }
    for (const record of records) {
      const tests = record.tests.length > 0 ? ` [tests: ${record.tests.join(", ")}]` : "";
      const hashes = record.shaBefore ? ` [sha256 before ${record.shaBefore} after ${record.shaAfter}]` : "";
      const extra = record.testSummary ? ` (${record.testSummary})` : "";
      console.log(`${record.verdict} ${record.file} ${record.hunk}${tests}${extra}${hashes}: ${record.reason}`);
    }
    console.log(
      `summary: ${counts.pinned} pinned, ${counts.unpinned} UNPINNED, ${counts.noTests} no-tests, ` +
        `${counts.unverifiedRust} UNVERIFIED-rust, ${counts.unverifiedScope} UNVERIFIED-scope, ${counts.timeouts} timeout(s)`,
    );
    console.log(`scope: ${scopeNote}`);
    if (records.length === 0) console.log("no source hunks in range; nothing to discriminate.");
    console.log(`RESULT: ${outcome}`);
  }
  return exitCode;
}

async function checkHunk(root, hunk, mapped, timeoutMs) {
  const abs = join(root, hunk.file);
  const existed = existsSync(abs);
  const before = existed ? readFileSync(abs) : null;
  const beforeMode = existed ? statSync(abs).mode : null;
  const shaBefore = before === null ? "absent" : sha256Hex(before);
  const restore = () => {
    if (before === null) {
      rmSync(abs, { force: true });
    } else {
      writeFileSync(abs, before);
      if (beforeMode !== null) chmodSync(abs, beforeMode);
    }
  };
  activeRestore = restore;
  const scratch = mkdtempSync(join(tmpdir(), "disc-gate-"));
  const patchPath = join(scratch, "hunk.patch");
  try {
    writeFileSync(patchPath, singleHunkPatch(hunk));
    const applied = gitSync(root, ["apply", "-R", patchPath]);
    if (!applied.ok) {
      restore();
      const record = {
        file: hunk.file,
        hunk: hunk.header,
        verdict: "infra",
        reason: `could not reverse-apply the hunk: ${applied.stderr.trim().slice(0, 300) || applied.error || `exit ${applied.code}`}`,
        tests: mapped,
        shaBefore,
        shaAfter: sha256Hex(existed && existsSync(abs) ? readFileSync(abs) : Buffer.of()),
      };
      return { record, infra: record.reason };
    }
    const vitestPath = join(root, "apps/desktop/node_modules/vitest/vitest.mjs");
    const commands = commandForTests(process.execPath, vitestPath, mapped);
    if (commands.some((c) => c.kind === "vitest") && !existsSync(vitestPath)) {
      const record = {
        file: hunk.file,
        hunk: hunk.header,
        verdict: "infra",
        reason: `vitest runner missing at ${vitestPath}; run pnpm install first`,
        tests: mapped,
        shaBefore,
        shaAfter: "unknown",
      };
      return { record, infra: record.reason };
    }
    let failed = 0;
    let ran = 0;
    const summaries = [];
    for (const command of commands) {
      const run = await runCommand(command.argv, root, timeoutMs);
      ran += 1;
      if (run.timedOut || run.spawnError) {
        const record = {
          file: hunk.file,
          hunk: hunk.header,
          verdict: "timeout",
          reason: run.timedOut
            ? `test command timed out after ${timeoutMs}ms and its process group was killed`
            : `could not start the test command: ${run.stderr.slice(-300)}`,
          tests: mapped,
          shaBefore,
          shaAfter: "unknown",
        };
        return { record, infra: record.reason };
      }
      if (run.code !== 0) {
        failed += 1;
        summaries.push(`${command.kind} exited ${run.code}`);
      } else {
        summaries.push(`${command.kind} passed`);
      }
    }
    const verdict = failed > 0 ? "pinned" : "UNPINNED";
    const reason =
      failed > 0
        ? `${failed} of ${ran} test command(s) failed with the hunk reverted; the tests pin this change`
        : `all ${ran} test command(s) still passed with the hunk reverted; the tests pin nothing`;
    restore();
    activeRestore = null;
    const after = existsSync(abs) ? readFileSync(abs) : null;
    const shaAfter = after === null ? "absent" : sha256Hex(after);
    if (shaBefore !== shaAfter) {
      const record = {
        file: hunk.file,
        hunk: hunk.header,
        verdict: "infra",
        reason: `restore mismatch: sha256 ${shaBefore} before, ${shaAfter} after; tree left dirty, investigate`,
        tests: mapped,
        testSummary: summaries.join("; "),
        shaBefore,
        shaAfter,
      };
      return { record, infra: record.reason };
    }
    return {
      record: {
        file: hunk.file,
        hunk: hunk.header,
        verdict,
        reason,
        tests: mapped,
        testSummary: summaries.join("; "),
        shaBefore,
        shaAfter,
      },
      infra: null,
    };
  } finally {
    try {
      restore();
    } catch {
      // Restore errors surface through the hash check above; never throw from cleanup.
    } finally {
      activeRestore = null;
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

const invokedAsMain = (() => {
  try {
    return process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (invokedAsMain) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      try {
        activeRestore?.();
      } catch {
        // Restore already attempted; report the original failure.
      }
      console.error(`discrimination gate: infrastructure failure: ${error?.message ?? String(error)}`);
      process.exitCode = 2;
    });
}
