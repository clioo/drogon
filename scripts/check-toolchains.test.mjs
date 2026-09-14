import assert from "node:assert/strict";
import test from "node:test";
import { checkNode, checkPnpm, checkRustc, parseMajor, parseTriple, preflight } from "./check-toolchains.mjs";

test("node floor accepts 24-26 and rejects 22 and 27 with a fix", () => {
  assert.equal(checkNode("v24.19.0").ok, true);
  assert.equal(checkNode("v26.0.0").ok, true);
  for (const bad of ["v22.12.0", "v27.0.0", "v20.9.0", "garbage"]) {
    const result = checkNode(bad);
    assert.equal(result.ok, false, bad);
    if (bad !== "garbage") assert.match(result.detail, /install Node 24/);
  }
});

test("pnpm must match the packageManager pin exactly", () => {
  assert.equal(checkPnpm("11.19.0", "pnpm@11.19.0").ok, true);
  for (const bad of ["9.15.0", "10.0.0", "", "11.19.1"]) {
    const result = checkPnpm(bad, "pnpm@11.19.0");
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.match(result.detail, /npm install -g pnpm@11\.19\.0/);
  }
});

test("rustc floor is 1.98 with an upgrade hint", () => {
  assert.equal(checkRustc("rustc 1.98.0 (88d9e12ae 2026-08-18)").ok, true);
  assert.equal(checkRustc("rustc 1.99.0-nightly (abc 2026-01-01)").ok, true);
  const old = checkRustc("rustc 1.97.0 (abcdef 2026-01-01)");
  assert.equal(old.ok, false);
  assert.match(old.detail, /rustup/);
  assert.equal(checkRustc("not a version").ok, false);
});

test("version parsers reject garbage instead of throwing", () => {
  assert.ok(Number.isNaN(parseMajor("")));
  assert.equal(parseTriple("no digits here"), null);
});

test("live preflight passes on this machine and reports every tool", () => {
  const result = preflight();
  assert.equal(result.schema, "drogon.toolchain-preflight/1");
  assert.deepEqual(
    result.checks.map((c) => c.name),
    ["node", "pnpm", "rustc", "git", "gh"],
  );
  assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
});
