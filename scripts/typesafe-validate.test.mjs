import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runCli, validateTypeSafe } from "./typesafe-validate.mjs";

const FIXTURE_KEY = "fixture-typesafe-key";

function passedBody() {
  return {
    model: "jev-latest",
    answers: {
      positive: { type: "noul", noul: 0.91 },
      negative: { type: "noul", noul: 0.04 },
    },
  };
}

function okFetch(body = passedBody()) {
  const calls = [];
  const fetchImpl = async (url, request) => {
    calls.push({ url, request });
    return {
      ok: true,
      status: 200,
      json: async () => body,
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test("skips a missing key without a request", async () => {
  const fetchImpl = okFetch();
  const result = await validateTypeSafe({ repoRoot: tmpdir(), env: {}, fetchImpl });
  assert.equal(result.status, "skipped");
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(result.message.includes(FIXTURE_KEY), false);
});

test("an explicitly blank inherited key skips and does not read .env", async () => {
  const root = mkdtempSync(join(tmpdir(), "drogon-typesafe-"));
  writeFileSync(join(root, ".env"), `TYPESAFE_API_KEY=${FIXTURE_KEY}\n`);
  const fetchImpl = okFetch();
  const result = await validateTypeSafe({
    repoRoot: root,
    env: { TYPESAFE_API_KEY: "  " },
    fetchImpl,
  });
  assert.equal(result.status, "skipped");
  assert.equal(fetchImpl.calls.length, 0);
  rmSync(root, { recursive: true, force: true });
});

test("reads a quoted root .env and lets the environment override it", async () => {
  const root = mkdtempSync(join(tmpdir(), "drogon-typesafe-"));
  writeFileSync(
    join(root, ".env"),
    'TYPESAFE_API_KEY="file-key" # comment\nTYPESAFE_BASE_URL=https://file.example/\nTYPESAFE_DEFAULT_MODEL=file-model\nIGNORED=value\n',
  );
  const fetchImpl = okFetch();
  const fromFile = await validateTypeSafe({ repoRoot: root, env: {}, fetchImpl });
  assert.equal(fromFile.status, "passed");
  assert.equal(fetchImpl.calls[0].url.href, "https://file.example/v1/systemone");
  assert.equal(fetchImpl.calls[0].request.headers.Authorization, "Bearer file-key");
  assert.equal(JSON.parse(fetchImpl.calls[0].request.body).model, "file-model");

  const overridden = await validateTypeSafe({
    repoRoot: root,
    env: {
      TYPESAFE_API_KEY: ` ${FIXTURE_KEY} `,
      TYPESAFE_BASE_URL: "https://override.example/proxy/",
      TYPESAFE_DEFAULT_MODEL: "override-model",
    },
    fetchImpl,
  });
  assert.equal(overridden.status, "passed");
  assert.equal(fetchImpl.calls[1].url.href, "https://override.example/proxy/v1/systemone");
  assert.equal(fetchImpl.calls[1].request.headers.Authorization, `Bearer ${FIXTURE_KEY}`);
  assert.equal(JSON.parse(fetchImpl.calls[1].request.body).model, "override-model");
  assert.equal(fetchImpl.calls[1].request.redirect, "manual");
  rmSync(root, { recursive: true, force: true });
});

test("a blank inherited base URL or model falls back to the documented default", async () => {
  const root = mkdtempSync(join(tmpdir(), "drogon-typesafe-"));
  writeFileSync(
    join(root, ".env"),
    "TYPESAFE_BASE_URL=https://file.example\nTYPESAFE_DEFAULT_MODEL=file-model\n",
  );
  const fetchImpl = okFetch();
  await validateTypeSafe({
    repoRoot: root,
    env: { TYPESAFE_API_KEY: FIXTURE_KEY, TYPESAFE_BASE_URL: "", TYPESAFE_DEFAULT_MODEL: " " },
    fetchImpl,
  });
  assert.equal(fetchImpl.calls[0].url.href, "https://api.typesafe.ai/v1/systemone");
  assert.equal(JSON.parse(fetchImpl.calls[0].request.body).model, "jev-latest");
  rmSync(root, { recursive: true, force: true });
});

test("rejects a base URL with credentials, a query, or a non-HTTP scheme", async () => {
  const fetchImpl = okFetch();
  for (const base of ["https://user:pass@example.com", "https://example.com/v1?x=1", "javascript:alert(1)"]) {
    const result = await validateTypeSafe({
      repoRoot: tmpdir(),
      env: { TYPESAFE_API_KEY: FIXTURE_KEY, TYPESAFE_BASE_URL: base },
      fetchImpl,
    });
    assert.equal(result.status, "failed", base);
  }
  assert.equal(fetchImpl.calls.length, 0);
});

test("an HTTP error names the status and not the body or the key", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: FIXTURE_KEY }),
  });
  const result = await validateTypeSafe({
    repoRoot: tmpdir(),
    env: { TYPESAFE_API_KEY: FIXTURE_KEY },
    fetchImpl,
  });
  assert.equal(result.status, "failed");
  assert.match(result.message, /HTTP 401/);
  assert.equal(result.message.includes(FIXTURE_KEY), false);
});

test("a timeout, a transport failure, and a decode error stay generic", async () => {
  const timeout = await validateTypeSafe({
    repoRoot: tmpdir(),
    env: { TYPESAFE_API_KEY: FIXTURE_KEY },
    fetchImpl: async () => {
      const error = new Error("slow");
      error.name = "TimeoutError";
      throw error;
    },
  });
  assert.match(timeout.message, /timed out/);

  const refused = await validateTypeSafe({
    repoRoot: tmpdir(),
    env: { TYPESAFE_API_KEY: FIXTURE_KEY },
    fetchImpl: async () => {
      const error = new TypeError("connect ECONNREFUSED 10.1.2.3");
      error.code = "ECONNREFUSED";
      throw error;
    },
  });
  assert.match(refused.message, /could not be reached/);
  assert.equal(refused.message.includes("10.1.2.3"), false);

  const decoded = await validateTypeSafe({
    repoRoot: tmpdir(),
    env: { TYPESAFE_API_KEY: FIXTURE_KEY },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    }),
  });
  assert.match(decoded.message, /decoding failed/);
});

test("a sample that misses 0.5 fails closed", async () => {
  const result = await validateTypeSafe({
    repoRoot: tmpdir(),
    env: { TYPESAFE_API_KEY: FIXTURE_KEY },
    fetchImpl: okFetch({
      model: "jev-latest",
      answers: {
        positive: { type: "noul", noul: 0.2 },
        negative: { type: "noul", noul: 0.1 },
      },
    }),
  });
  assert.equal(result.status, "failed");
  assert.match(result.message, /synthetic urgency/);
});

test("the Stop hook prints {} on skip and a systemMessage on failure, both exit 0", async () => {
  const skipped = await runCli({
    args: ["--hook"],
    input: "{}",
    env: {},
    repoRoot: tmpdir(),
    fetchImpl: okFetch(),
  });
  assert.equal(skipped.exitCode, 0);
  assert.deepEqual(JSON.parse(skipped.output), {});

  const failed = await runCli({
    args: ["--hook"],
    input: "{}",
    env: { TYPESAFE_API_KEY: FIXTURE_KEY },
    repoRoot: tmpdir(),
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
  });
  assert.equal(failed.exitCode, 0);
  const report = JSON.parse(failed.output);
  assert.match(report.systemMessage, /HTTP 500/);
  assert.equal("decision" in report, false);
  assert.equal(failed.error.includes(FIXTURE_KEY), false);
});

test("a non-hook failure exits 1 and a bad argument prints usage", async () => {
  const failed = await runCli({
    args: [],
    env: { TYPESAFE_API_KEY: FIXTURE_KEY },
    repoRoot: tmpdir(),
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  assert.equal(failed.exitCode, 1);
  assert.match(failed.output, /HTTP 503/);

  const usage = await runCli({ args: ["--nope"], env: {}, repoRoot: tmpdir() });
  assert.equal(usage.exitCode, 1);
  assert.match(usage.output, /Usage:/);

  const badHook = await runCli({ args: ["--hook"], input: "not-json", env: {}, repoRoot: tmpdir() });
  assert.equal(badHook.exitCode, 0);
  assert.match(JSON.parse(badHook.output).systemMessage, /invalid Stop hook input/);
});

test("the executable skip path exits 0 when no key is configured", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, ["scripts/typesafe-validate.mjs"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, TYPESAFE_API_KEY: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skipped/);
  assert.equal(result.stdout.includes("file-key"), false);
});

test("the Codex hook points at this validator", () => {
  const hooks = JSON.parse(readFileSync(new URL("../.codex/hooks.json", import.meta.url), "utf8"));
  const stop = hooks.hooks.Stop.flatMap((entry) => entry.hooks);
  assert.equal(stop.length, 1);
  assert.match(stop[0].command, /scripts\/typesafe-validate\.mjs" --hook$/);
  assert.equal(stop[0].timeout, 25);
});
