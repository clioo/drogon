// Source guard for the cold headless-runner screenshot budget: every
// evidence screenshot on the --files journey path must carry an explicit
// timeout of at least SCREENSHOT_BUDGET_MS.
//
// This is a STATIC check, not a journey: it is spawn-free and build-free,
// reading the journey sources as text. Playwright's default 15s screenshot
// budget times out on a cold xvfb/software-rendered ubuntu runner even
// after fonts load (CI proof on PR #633: "fonts loaded" then Timeout
// 15000ms exceeded), so the budget is explicit and generous while still
// failing loudly on a real hang. Removing a budget (or adding a new
// budget-less screenshot on this path) makes this check FAIL.
//
// Failure-evidence shots (*failure.png*) are exempt: they are already
// catch-guarded and must stay fast-fail so the original error surfaces.
//
// Usage: node scripts/check-screenshot-budget.mjs [--root DIR]
// Exits nonzero unless every check passes; prints one JSON verdict.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..");

// Honest budget for a cold headless runner (cold start + software
// compositing of a heavy renderer page); still fails loudly on a hang.
export const SCREENSHOT_BUDGET_MS = 120_000;

// Every file whose screenshots run on the `accept-desktop.mjs --files` path.
export const BUDGET_FILES = [
  "scripts/accept-desktop.mjs",
  "scripts/probe-workspace-properties.mjs",
  "scripts/probe-editor-keyboard-input.mjs",
  "scripts/probe-orchestrator.mjs",
  "scripts/probe-rendered-mentu-tab.mjs",
];

export function parseArgs(argv = []) {
  const options = { root: DEFAULT_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      options.root = path.resolve(argv[++index] ?? "");
      assert.ok(options.root && argv[index], "--root requires a directory");
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-screenshot-budget.mjs [--root DIR]");
      process.exit(0);
    } else {
      assert.fail(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

// Extract the first {...} options block starting at or after `from`.
// Returns the block text or null when the braces never balance.
function optionsBlock(source, from) {
  const open = source.indexOf("{", from);
  if (open === -1) return null;
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

export function checkScreenshotBudget(source, fileLabel) {
  const problems = [];
  const pattern = /\.screenshot\s*\(/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const block = optionsBlock(source, match.index + match[0].length);
    if (block === null) {
      problems.push(`${fileLabel}: unterminated screenshot options near offset ${match.index}`);
      continue;
    }
    if (block.includes("failure.png")) continue;
    const timeout = block.match(/timeout\s*:\s*([\d_]+)/);
    const ms = timeout ? Number(timeout[1].replace(/_/g, "")) : null;
    if (ms === null || Number.isNaN(ms) || ms < SCREENSHOT_BUDGET_MS) {
      problems.push(
        `${fileLabel}: screenshot near offset ${match.index} lacks an honest cold-runner budget (timeout >= ${SCREENSHOT_BUDGET_MS})`,
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

export async function runJourney({ root }) {
  const checks = [];
  const problems = [];
  for (const rel of BUDGET_FILES) {
    const source = await readFile(path.join(root, rel), "utf8");
    const result = checkScreenshotBudget(source, rel);
    checks.push(`${rel}: ${result.problems.length} under-budget screenshot(s)`);
    problems.push(...result.problems);
  }
  return {
    status: problems.length === 0 ? "PASSED" : "FAILED",
    checks,
    problems,
  };
}

const invoked = process.argv[1] === fileURLToPath(import.meta.url);
if (invoked) {
  const { root } = parseArgs(process.argv.slice(2));
  const verdict = await runJourney({ root });
  console.log(JSON.stringify(verdict));
  process.exit(verdict.status === "PASSED" ? 0 : 1);
}
