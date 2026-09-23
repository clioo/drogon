// Source guard for the background-window restore contract: closing and
// restoring a window must never activate the app during validation.
//
// This is a STATIC check, not a journey: it is spawn-free and build-free,
// reading the desktop main sources as text and pinning the exact rule that
// keeps `DROGON_BACKGROUND_WINDOW=1` runs hidden — the saved-bounds/maximized
// restore path must stay behind the background guard, and no activation call
// may appear on any unguarded path. Removing the guard (or adding a stray
// show/focus/restore) makes this check FAIL. Runtime proof that a restored
// window stays hidden comes from `DROGON_VERIFY_OS_FOCUS=1
// node scripts/accept-desktop.mjs`, not from here.
//
// Usage: node scripts/check-background-window-guard.mjs [--root DIR]
// Exits nonzero unless every check passes; prints one JSON verdict.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..");

export const WINDOW_STATE_REL = path.join("apps", "desktop", "src", "main", "window", "window-state.ts");
export const MAIN_INDEX_REL = path.join("apps", "desktop", "src", "main", "index.ts");

// Activation APIs that must never run on an unguarded background path.
const FORBIDDEN_BARE = [
  "bringToFront",
  "app.focus(",
  "BrowserWindow.focus(",
  "showInactive(",
  "moveTop(",
];

export function parseArgs(argv = []) {
  const options = { root: DEFAULT_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      options.root = path.resolve(argv[++index] ?? "");
      assert.ok(options.root && argv[index], "--root requires a directory");
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-background-window-guard.mjs [--root DIR]");
      process.exit(0);
    } else {
      assert.fail(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`) >= 0
    ? source.indexOf(`function ${name}(`)
    : source.indexOf(`${name}(`);
  assert.ok(start >= 0, `${name} not found in source`);
  // Skip the parameter list (it may carry its own braces, e.g. an inline
  // object type) by walking to its matching close paren first.
  const paren = source.indexOf("(", start);
  let parenDepth = 0;
  let open = -1;
  for (let i = paren; i < source.length; i += 1) {
    if (source[i] === "(") parenDepth += 1;
    if (source[i] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        open = source.indexOf("{", i + 1);
        break;
      }
    }
  }
  assert.ok(open >= 0, `${name} body not found`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  assert.fail(`unterminated ${name} body`);
}

export function checkRevealGuard(windowStateSource) {
  const problems = [];
  const body = functionBody(windowStateSource, "revealRestoredWindow");
  const guardAt = body.indexOf("if (backgroundWindow) return;");
  if (guardAt < 0) {
    problems.push("revealRestoredWindow has no background early-return guard");
    return { ok: false, problems };
  }
  for (const call of ["window.maximize()", "window.show()"]) {
    const at = body.indexOf(call);
    if (at >= 0 && at < guardAt) {
      problems.push(`${call} runs before the background guard in revealRestoredWindow`);
    }
  }
  if (!body.includes("window.show()")) {
    problems.push("revealRestoredWindow no longer reveals visible launches at all");
  }
  return { ok: problems.length === 0, problems };
}

export function checkCreateWindow(mainSource) {
  const problems = [];
  if (!mainSource.includes("show: false,")) {
    problems.push("createWindow must construct the BrowserWindow with show: false");
  }
  if (!mainSource.includes("backgroundWindow ? { focusable: false, skipTaskbar: true }")) {
    problems.push("createWindow must pass focusable:false + skipTaskbar in background mode");
  }
  if (!mainSource.includes("revealRestoredWindow({")) {
    problems.push("ready-to-show must route through revealRestoredWindow, not a direct show");
  }
  const readyToShow = mainSource.slice(mainSource.indexOf('once("ready-to-show"'));
  const directShow = readyToShow.slice(0, 400).match(/window\.show\(\)/);
  if (directShow) {
    problems.push("ready-to-show handler calls window.show() directly, bypassing the background guard");
  }
  return { ok: problems.length === 0, problems };
}

export function checkSecondInstance(mainSource) {
  const problems = [];
  const at = mainSource.indexOf('on("second-instance"');
  if (at < 0) {
    problems.push("second-instance handler is missing");
    return { ok: false, problems };
  }
  const window_ = mainSource.slice(at, at + 600);
  if (!window_.includes("!backgroundWindow")) {
    problems.push("second-instance handler must refuse to restore/focus a background window");
  }
  return { ok: problems.length === 0, problems };
}

export function checkNoBareActivation(mainSource, windowStateSource) {
  const problems = [];
  for (const token of FORBIDDEN_BARE) {
    for (const [label, source] of [["index.ts", mainSource], ["window-state.ts", windowStateSource]]) {
      if (source.includes(token)) {
        problems.push(`${token} appears in ${label} with no known background guard`);
      }
    }
  }
  // window.focus()/restore() are allowed only inside the guarded
  // second-instance handler; window.show() only inside revealRestoredWindow.
  const afterSecond = (() => {
    const start = mainSource.indexOf('on("second-instance"');
    let depth = 0;
    const open = mainSource.indexOf("{", start);
    for (let i = open; i < mainSource.length; i += 1) {
      if (mainSource[i] === "{") depth += 1;
      if (mainSource[i] === "}") {
        depth -= 1;
        if (depth === 0) return mainSource.slice(0, start) + mainSource.slice(i + 1);
      }
    }
    return mainSource;
  })();
  for (const call of ["window.focus()", "window.restore()"]) {
    if (afterSecond.includes(call)) {
      problems.push(`${call} appears outside the guarded second-instance handler`);
    }
  }
  // Showing has no legitimate call site in main at all: visible launches
  // reveal through revealRestoredWindow, and background runs never reveal.
  for (const call of ["window.show()", ".showInactive("]) {
    if (mainSource.includes(call)) {
      problems.push(`${call} appears in index.ts; reveal only through revealRestoredWindow`);
    }
  }
  const revealBody = functionBody(windowStateSource, "revealRestoredWindow");
  const outsideReveal = windowStateSource.replace(revealBody, "");
  if (outsideReveal.includes("window.show()") || outsideReveal.includes(".showInactive(")) {
    problems.push("window.show()/showInactive() appears outside revealRestoredWindow");
  }
  return { ok: problems.length === 0, problems };
}

export async function runJourney({ root = DEFAULT_ROOT, read = readFile } = {}) {
  const checks = [];
  const problems = [];
  let mainSource = null;
  let windowStateSource = null;
  try {
    windowStateSource = await read(path.join(root, WINDOW_STATE_REL), "utf8");
  } catch {
    problems.push(`unreadable: ${WINDOW_STATE_REL}`);
  }
  try {
    mainSource = await read(path.join(root, MAIN_INDEX_REL), "utf8");
  } catch {
    problems.push(`unreadable: ${MAIN_INDEX_REL}`);
  }
  if (mainSource && windowStateSource) {
    const suite = [
      ["reveal-guard-before-activation", () => checkRevealGuard(windowStateSource)],
      ["create-window-stays-hidden", () => checkCreateWindow(mainSource)],
      ["second-instance-refuses-background", () => checkSecondInstance(mainSource)],
      ["no-bare-activation", () => checkNoBareActivation(mainSource, windowStateSource)],
    ];
    for (const [name, run] of suite) {
      checks.push(name);
      try {
        const result = run();
        if (!result.ok) problems.push(...result.problems);
      } catch (error) {
        problems.push(`${name}: ${error.message}`);
      }
    }
  }
  return {
    status: problems.length === 0 ? "PASSED" : "FAILED",
    journey: "scripts/check-background-window-guard.mjs",
    checks,
    problems,
  };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]);
if (invoked === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const verdict = await runJourney({ root: options.root });
  console.log(JSON.stringify(verdict, null, 2));
  if (verdict.status !== "PASSED") process.exitCode = 1;
}
