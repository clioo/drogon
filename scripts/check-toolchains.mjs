#!/usr/bin/env node
// Preflight for a clean machine: fail fast with "you need X" instead of a
// confusing compile error when Node, pnpm, Rust or git is missing or too old.
// Run: node scripts/check-toolchains.mjs [--json]
// The floors mirror package.json `engines` (node >=24 <27), the
// `packageManager` pin, and the README (Rust 1.98). `gh` is optional: only
// the GitHub-backed surfaces need it, so it warns instead of failing.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const NODE_FLOOR_MAJOR = 24;
export const NODE_CEIL_MAJOR = 27;
export const RUST_FLOOR = [1, 98, 0];

export function parseMajor(version) {
  const match = /^v?(\d+)(?:\.|$)/.exec(version.trim());
  return match ? Number(match[1]) : NaN;
}

export function parseTriple(version) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function cmpTriple(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function checkNode(version) {
  const major = parseMajor(version);
  if (!Number.isInteger(major)) {
    return { ok: false, detail: `could not parse Node version ${JSON.stringify(version)}` };
  }
  if (major < NODE_FLOOR_MAJOR || major >= NODE_CEIL_MAJOR) {
    return {
      ok: false,
      detail:
        `Node ${version.trim()} is outside the supported range ` +
        `(need >=${NODE_FLOOR_MAJOR} <${NODE_CEIL_MAJOR}; install Node 24 from https://nodejs.org or \`brew install node@24\`)`,
    };
  }
  return { ok: true, detail: version.trim() };
}

export function checkPnpm(actual, pinned) {
  const want = String(pinned).trim().replace(/^pnpm@/, "");
  const got = String(actual).trim();
  if (got !== want) {
    return {
      ok: false,
      detail:
        `pnpm ${got || "(missing)"} does not match the pinned ${pinned} ` +
        `(run \`npm install -g ${pinned}\`; Corepack distributions can use \`corepack enable && corepack prepare ${pinned} --activate\`)`,
    };
  }
  return { ok: true, detail: got };
}

export function checkRustc(versionText) {
  const triple = parseTriple(versionText);
  if (!triple) {
    return { ok: false, detail: `could not parse rustc version from ${JSON.stringify(versionText.slice(0, 80))}` };
  }
  if (cmpTriple(triple, RUST_FLOOR) < 0) {
    return {
      ok: false,
      detail:
        `rustc ${triple.join(".")} is older than the ${RUST_FLOOR.join(".")} floor ` +
        `(run \`rustup update\` or \`rustup toolchain install ${RUST_FLOOR.slice(0, 2).join(".")}\`; https://rustup.rs)`,
    };
  }
  return { ok: true, detail: triple.join(".") };
}

export function pinnedPnpm(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (typeof pkg?.packageManager !== "string" || !/^pnpm@\d+\.\d+\.\d+$/.test(pkg.packageManager)) {
    throw new Error("package.json must declare a pinned pnpm version");
  }
  return pkg.packageManager;
}

function run(cmd, args) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: "utf8", timeout: 30000 }).trim() };
  } catch (error) {
    return { ok: false, out: error?.message ?? String(error) };
  }
}

export function preflight(root = join(dirname(fileURLToPath(import.meta.url)), "..")) {
  const checks = [];
  const node = run(process.execPath, ["--version"]);
  checks.push({ name: "node", ...node.ok ? checkNode(node.out) : { ok: false, detail: `node failed: ${node.out}` } });
  let pinned = "pnpm@?";
  try {
    pinned = pinnedPnpm(root);
  } catch (error) {
    checks.push({ name: "pnpm-pin", ok: false, detail: error.message });
  }
  const pnpm = run("pnpm", ["--version"]);
  checks.push({
    name: "pnpm",
    ...(pnpm.ok ? checkPnpm(pnpm.out, pinned) : { ok: false, detail: `pnpm not found (need ${pinned}; run \`npm install -g ${pinned}\`)` }),
  });
  const rustc = run("rustc", ["--version"]);
  checks.push({ name: "rustc", ...rustc.ok ? checkRustc(rustc.out) : { ok: false, detail: "rustc not found (install Rust 1.98 via https://rustup.rs)" } });
  const git = run("git", ["--version"]);
  checks.push({ name: "git", ...(git.ok ? { ok: true, detail: git.out } : { ok: false, detail: "git not found (install Xcode Command Line Tools or https://git-scm.com)" }) });
  const gh = run("gh", ["--version"]);
  checks.push({
    name: "gh",
    ...(gh.ok ? { ok: true, detail: gh.out.split("\n")[0] } : { ok: true, optional: true, detail: "gh not found; only the GitHub-backed surfaces (Tasks, PR cells) need it" }),
  });
  return { schema: "drogon.toolchain-preflight/1", ok: checks.every((c) => c.ok), checks };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = preflight();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const check of result.checks) {
      const flag = check.ok ? (check.optional ? "warn" : "ok") : "FAIL";
      console.log(`${flag}  ${check.name}: ${check.detail}`);
    }
  }
  if (!result.ok) process.exitCode = 1;
}
