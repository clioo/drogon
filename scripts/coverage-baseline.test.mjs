// coverage-baseline.test.mjs — ratchet behaviour for scripts/coverage-baseline.mjs.
// node builtins only: `node --test scripts/coverage-baseline.test.mjs`.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  aggregateAreas,
  buildBaseline,
  findDrops,
  loadSummary,
  summarizeTotal,
} from "./coverage-baseline.mjs";

const SCRIPT = fileURLToPath(new URL("./coverage-baseline.mjs", import.meta.url));

function counters(covered, total = 10000) {
  return { total, covered, skipped: 0, pct: (covered / total) * 100 };
}

function fileEntry(covered, total = 10000) {
  return {
    lines: counters(covered, total),
    statements: counters(covered, total),
    branches: counters(covered, total),
    functions: counters(covered, total),
  };
}

// A synthetic json-summary with one file per area plus a total entry.
function makeSummary(perAreaCovered, total = 10000) {
  const summary = {
    "/repo/apps/desktop/src/main/bridge.ts": fileEntry(perAreaCovered.main ?? 8000, total),
    "/repo/apps/desktop/src/preload/index.ts": fileEntry(perAreaCovered.preload ?? 8000, total),
    "/repo/apps/desktop/src/renderer/src/app.ts": fileEntry(perAreaCovered.renderer ?? 8000, total),
    "/repo/apps/desktop/src/shared/contract.ts": fileEntry(perAreaCovered.shared ?? 8000, total),
  };
  const areas = ["main", "preload", "renderer", "shared"];
  const covered = areas.reduce((n, area) => n + (perAreaCovered[area] ?? 8000), 0);
  summary.total = fileEntry(covered, total * areas.length);
  return summary;
}

function writeJson(dir, name, value) {
  const file = path.join(dir, name);
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}

function runCli(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

function baselineFrom(summary) {
  return buildBaseline(aggregateAreas(summary), summarizeTotal(summary));
}

test("a coverage drop is caught", () => {
  const baseline = baselineFrom(makeSummary({}));
  const current = makeSummary({ renderer: 7000 });
  const drops = findDrops(aggregateAreas(current), summarizeTotal(current), baseline, 0.5);
  assert.ok(drops.some((d) => d.area === "renderer" && d.metric === "statements"));
  assert.ok(drops.every((d) => d.drop > 0.5));

  const dir = mkdtempSync(path.join(tmpdir(), "cov-drop-"));
  const baselinePath = writeJson(dir, "baseline.json", baseline);
  const summaryPath = writeJson(dir, "summary.json", current);
  const result = runCli("--check", baselinePath, "--summary", summaryPath);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /drop: renderer\.statements/);
});

test("an improvement passes the check", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cov-up-"));
  const baselinePath = writeJson(dir, "baseline.json", baselineFrom(makeSummary({})));
  const summaryPath = writeJson(dir, "summary.json", makeSummary({ main: 9000 }));
  const result = runCli("--check", baselinePath, "--summary", summaryPath);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /coverage holds/);
});

test("equal-within-tolerance values pass, beyond-tolerance drops fail", () => {
  const baseline = baselineFrom(makeSummary({}));
  // Exactly at tolerance (80.00 -> 79.50, drop == 0.5pp) still passes.
  const edge = makeSummary({ shared: 7950 });
  assert.equal(findDrops(aggregateAreas(edge), summarizeTotal(edge), baseline, 0.5).length, 0);
  // Just beyond tolerance fails.
  const over = makeSummary({ shared: 7900 });
  assert.equal(findDrops(aggregateAreas(over), summarizeTotal(over), baseline, 0.5).length > 0, true);

  const dir = mkdtempSync(path.join(tmpdir(), "cov-tol-"));
  const baselinePath = writeJson(dir, "baseline.json", baseline);
  const edgePath = writeJson(dir, "edge.json", edge);
  const overPath = writeJson(dir, "over.json", over);
  assert.equal(runCli("--check", baselinePath, "--summary", edgePath).status, 0);
  assert.equal(runCli("--check", baselinePath, "--summary", overPath).status, 1);
});

test("a missing summary exits non-zero instead of passing", () => {
  assert.throws(() => loadSummary(path.join(tmpdir(), "drogon-no-such-summary.json")), /not found/);
  const missing = runCli("--summary", path.join(tmpdir(), "drogon-no-such-summary.json"));
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /not found/);
});

test("a corrupt summary exits non-zero instead of passing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cov-corrupt-"));
  const badPath = writeJson(dir, "summary.json", "{not valid json");
  assert.throws(() => loadSummary(badPath), /not valid JSON/);
  const result = runCli("--summary", badPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not valid JSON/);
});

test("a summary with no measurable entries exits non-zero", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cov-empty-"));
  const emptyPath = writeJson(dir, "summary.json", { total: fileEntry(0, 0) });
  const result = runCli("--summary", emptyPath);
  assert.notEqual(result.status, 0);
});

test("--write round-trips: the recorded baseline passes against its own summary", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cov-write-"));
  const summaryPath = writeJson(dir, "summary.json", makeSummary({ renderer: 8500 }));
  const baselinePath = path.join(dir, "baseline.json");
  const written = runCli("--write", baselinePath, "--summary", summaryPath);
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stdout, /wrote baseline/);
  const check = runCli("--check", baselinePath, "--summary", summaryPath);
  assert.equal(check.status, 0, check.stderr);
});

test("a missing baseline fails closed on --check", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cov-nobase-"));
  const summaryPath = writeJson(dir, "summary.json", makeSummary({}));
  const result = runCli("--check", path.join(dir, "baseline.json"), "--summary", summaryPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /baseline not found/);
});
