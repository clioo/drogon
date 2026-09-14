import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  PORTABLE_GATES,
  README_COMMANDS,
  assertSafeWorkRoot,
  checkGate,
  probeMachinePaths,
  readmeCoversCommands,
} from "./e2e-fresh-clone.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

test("README documents every verbatim fresh-clone command", () => {
  const missing = readmeCoversCommands("# Run locally\n```sh\ngit clone https://github.com/clioo/drogon.git\n```\n");
  assert.ok(missing.length > 0, "fixture fence is deliberately incomplete");
  assert.ok(missing.includes("pnpm install --frozen-lockfile"));
});

test("live README covers the verbatim command set", () => {
  const missing = readmeCoversCommands(readFileSync(path.join(root, "README.md"), "utf8"));
  assert.deepEqual(missing, []);
});

test("machine-path probe flags the auditor's home and the brew prefix", (t) => {
  const base = mkdtempSync(path.join(tmpdir(), "drogon-probe-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  writeFileSync(path.join(base, "user-script.mjs"), "const p = '/Users/alice/work/x';\n");
  writeFileSync(path.join(base, "brew-script.mjs"), "const p = '/opt/homebrew/bin';\n");
  writeFileSync(path.join(base, "synthetic-test.mjs"), "const p = '/Users/x/fixture';\n");
  writeFileSync(path.join(base, "clean.mjs"), "console.log('hello');\n");
  mkdirSync(path.join(base, "tests/parity"), { recursive: true });
  writeFileSync(path.join(base, "tests/parity/frozen.json"), "{ \"p\": \"/Users/alice/frozen\" }\n");
  const findings = probeMachinePaths(base, "alice");
  const byPath = new Map(findings.map((f) => [f.path, f.rule]));
  assert.equal(byPath.get("user-script.mjs"), "owner-path");
  assert.equal(byPath.get("brew-script.mjs"), "brew-path");
  assert.ok(!byPath.has("synthetic-test.mjs"), "synthetic /Users/x fixtures are not this machine");
  assert.ok(!byPath.has("clean.mjs"));
  assert.ok(!byPath.has("tests/parity/frozen.json"), "frozen evidence is byte-exact by design");
});

test("work root guard refuses /Applications, $HOME and relative paths", () => {
  assert.throws(() => assertSafeWorkRoot("/Applications/Drogon.app"), /\/Applications/);
  assert.throws(() => assertSafeWorkRoot(process.env.HOME), /work root/);
  assert.throws(() => assertSafeWorkRoot("relative/path"), /absolute/);
  assert.equal(assertSafeWorkRoot(path.join(tmpdir(), "drogon-x")).startsWith(tmpdir()), true);
});

test("portable gate list stays the documented Linux-capable subset", () => {
  assert.deepEqual(PORTABLE_GATES, [
    "pnpm install --frozen-lockfile",
    "cargo build --workspace --locked",
    "pnpm typecheck",
  ]);
  assert.ok(README_COMMANDS.includes("pnpm install --frozen-lockfile"));
});

test("fast check gate passes on this checkout", () => {
  const result = checkGate(root);
  assert.equal(result.schema, "drogon.fresh-clone-check/1");
  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
});
