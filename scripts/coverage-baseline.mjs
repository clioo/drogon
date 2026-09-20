#!/usr/bin/env node
// coverage-baseline.mjs — coverage ratchet for the desktop suite.
//
// Reads the `json-summary` output produced by `vitest run --coverage` in
// apps/desktop, prints a per-area table (renderer, main, preload, shared),
// and optionally compares against (or records) a committed baseline.
//
// Modes:
//   node scripts/coverage-baseline.mjs [--summary <path>]
//       Print the per-area table for a coverage summary. Default summary:
//       apps/desktop/coverage/coverage-summary.json.
//   node scripts/coverage-baseline.mjs --check <baseline.json> [--summary <path>] [--tolerance <pp>]
//       Exit 0 when coverage holds; exit 1 when any area/metric DROPS more
//       than <tolerance> percentage points below the baseline (a ratchet,
//       never a fixed target). Improvements and within-tolerance values pass.
//   node scripts/coverage-baseline.mjs --write <baseline.json> [--summary <path>]
//       Record a new baseline from a measured summary.
//
// Fail-closed: a missing or unparseable summary (or baseline, for --check)
// exits non-zero with the reason on stderr — never a pass for a measurement
// that did not happen.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const AREAS = ["renderer", "main", "preload", "shared"];
export const METRICS = ["statements", "branches", "functions", "lines"];
export const DEFAULT_TOLERANCE_PP = 0.5;
export const BASELINE_VERSION = 1;

const AREA_SEGMENT = {
  renderer: "src/renderer/",
  main: "src/main/",
  preload: "src/preload/",
  shared: "src/shared/",
};

export function defaultSummaryPath() {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../apps/desktop/coverage/coverage-summary.json",
  );
}

function areaOf(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const marker = "apps/desktop/";
  const idx = normalized.lastIndexOf(marker);
  const rel = idx >= 0 ? normalized.slice(idx + marker.length) : normalized;
  for (const area of AREAS) {
    if (rel.startsWith(AREA_SEGMENT[area])) return area;
  }
  return null;
}

function emptyCounters() {
  return { covered: 0, total: 0 };
}

function pct(covered, total) {
  if (total === 0) return 100;
  return (covered / total) * 100;
}

export function loadSummary(summaryPath) {
  let raw;
  try {
    raw = readFileSync(summaryPath, "utf8");
  } catch (err) {
    throw new Error(`coverage summary not found: ${summaryPath} (${err.code ?? err.message})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`coverage summary is not valid JSON: ${summaryPath} (${err.message})`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`coverage summary has unexpected shape: ${summaryPath} (expected an object)`);
  }
  return parsed;
}

// Aggregate per-file json-summary entries into per-area covered/total counts.
export function aggregateAreas(summary) {
  const areas = {};
  for (const area of AREAS) {
    areas[area] = { files: 0, statements: emptyCounters(), branches: emptyCounters(), functions: emptyCounters(), lines: emptyCounters() };
  }
  let files = 0;
  for (const [filePath, entry] of Object.entries(summary)) {
    if (filePath === "total") continue;
    if (entry === null || typeof entry !== "object") {
      throw new Error(`coverage summary entry for ${filePath} has unexpected shape`);
    }
    const area = areaOf(filePath);
    if (area === null) continue;
    areas[area].files += 1;
    files += 1;
    for (const metric of METRICS) {
      const node = entry[metric];
      if (node === null || typeof node !== "object" || typeof node.covered !== "number" || typeof node.total !== "number") {
        throw new Error(`coverage summary entry for ${filePath} is missing numeric ${metric} counters`);
      }
      areas[area][metric].covered += node.covered;
      areas[area][metric].total += node.total;
    }
  }
  if (files === 0) {
    throw new Error("coverage summary contains no per-file entries to aggregate");
  }
  const result = {};
  for (const area of AREAS) {
    result[area] = { files: areas[area].files };
    for (const metric of METRICS) {
      const { covered, total } = areas[area][metric];
      result[area][metric] = { covered, total, pct: pct(covered, total) };
    }
  }
  return result;
}

export function summarizeTotal(summary) {
  const total = summary.total;
  if (total === null || typeof total !== "object") {
    throw new Error("coverage summary is missing the total entry");
  }
  const out = {};
  for (const metric of METRICS) {
    const node = total[metric];
    if (node === null || typeof node !== "object" || typeof node.covered !== "number" || typeof node.total !== "number") {
      throw new Error(`coverage summary total is missing numeric ${metric} counters`);
    }
    out[metric] = { covered: node.covered, total: node.total, pct: pct(node.covered, node.total) };
  }
  return out;
}

export function loadBaseline(baselinePath) {
  let raw;
  try {
    raw = readFileSync(baselinePath, "utf8");
  } catch (err) {
    throw new Error(`baseline not found: ${baselinePath} (${err.code ?? err.message})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`baseline is not valid JSON: ${baselinePath} (${err.message})`);
  }
  if (parsed === null || typeof parsed !== "object" || parsed.areas === null || typeof parsed.areas !== "object") {
    throw new Error(`baseline has unexpected shape: ${baselinePath} (expected { areas, total })`);
  }
  return parsed;
}

function baselinePct(baseline, area, metric) {
  const scope = area === "total" ? baseline.total : baseline.areas?.[area];
  const value = scope?.[metric];
  // Baselines written by --write store { pct }; accept a bare number too.
  return typeof value === "number" ? value : value?.pct;
}

// Every (area, metric) pair whose current pct fell more than `tolerance`
// percentage points below the recorded baseline.
export function findDrops(areas, total, baseline, tolerance) {
  const drops = [];
  const scopes = { ...areas, total };
  for (const [area, scope] of Object.entries(scopes)) {
    for (const metric of METRICS) {
      const expected = baselinePct(baseline, area, metric);
      if (typeof expected !== "number" || Number.isNaN(expected)) continue;
      const current = scope[metric].pct;
      const drop = expected - current;
      if (drop > tolerance) {
        drops.push({ area, metric, baseline: expected, current, drop });
      }
    }
  }
  return drops;
}

function formatPct(value) {
  return value.toFixed(2).padStart(6);
}

export function formatTable(areas, total) {
  const header = "area      files  %stmts %branch  %funcs  %lines";
  const rows = [header];
  for (const area of AREAS) {
    const scope = areas[area];
    rows.push(
      `${area.padEnd(9)} ${String(scope.files).padStart(5)}` +
        METRICS.map((metric) => formatPct(scope[metric].pct)).join(" "),
    );
  }
  rows.push(
    `${"total".padEnd(9)} ${String("").padStart(5)}` +
      METRICS.map((metric) => formatPct(total[metric].pct)).join(" "),
  );
  return rows.join("\n");
}

export function buildBaseline(areas, total) {
  const baseline = { version: BASELINE_VERSION, generatedAt: new Date().toISOString(), areas: {}, total: {} };
  for (const area of AREAS) {
    baseline.areas[area] = { files: areas[area].files };
    for (const metric of METRICS) {
      baseline.areas[area][metric] = { ...areas[area][metric] };
    }
  }
  for (const metric of METRICS) {
    baseline.total[metric] = { ...total[metric] };
  }
  return baseline;
}

function parseArgs(argv) {
  const opts = { summary: null, check: null, write: null, tolerance: DEFAULT_TOLERANCE_PP };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--summary" && i + 1 < argv.length) opts.summary = argv[++i];
    else if (arg === "--check" && i + 1 < argv.length) opts.check = argv[++i];
    else if (arg === "--write" && i + 1 < argv.length) opts.write = argv[++i];
    else if (arg === "--tolerance" && i + 1 < argv.length) opts.tolerance = Number(argv[++i]);
    else if (arg.startsWith("--")) throw new Error(`unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 0 && opts.summary === null) opts.summary = positional[0];
  if (opts.check !== null && opts.write !== null) {
    throw new Error("pass either --check or --write, not both");
  }
  if (!(opts.tolerance >= 0)) throw new Error(`invalid --tolerance (expected a number >= 0)`);
  return opts;
}

export function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 2;
  }
  const summaryPath = opts.summary ?? defaultSummaryPath();
  let summary;
  try {
    summary = loadSummary(summaryPath);
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 2;
  }
  let areas;
  let total;
  try {
    areas = aggregateAreas(summary);
    total = summarizeTotal(summary);
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 2;
  }

  if (opts.write !== null) {
    writeFileSync(opts.write, `${JSON.stringify(buildBaseline(areas, total), null, 2)}\n`);
    console.log(formatTable(areas, total));
    console.log(`wrote baseline ${opts.write} from ${summaryPath}`);
    return 0;
  }

  if (opts.check !== null) {
    let baseline;
    try {
      baseline = loadBaseline(opts.check);
    } catch (err) {
      console.error(`error: ${err.message}`);
      return 2;
    }
    const drops = findDrops(areas, total, baseline, opts.tolerance);
    console.log(formatTable(areas, total));
    if (drops.length > 0) {
      for (const drop of drops) {
        console.error(
          `drop: ${drop.area}.${drop.metric} baseline ${drop.baseline.toFixed(2)} -> current ${drop.current.toFixed(2)} ` +
            `(-${drop.drop.toFixed(2)}pp, tolerance ${opts.tolerance}pp)`,
        );
      }
      return 1;
    }
    console.log(`coverage holds against ${opts.check} (tolerance ${opts.tolerance}pp)`);
    return 0;
  }

  console.log(formatTable(areas, total));
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
