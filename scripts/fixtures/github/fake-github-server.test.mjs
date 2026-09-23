// The GitHub fixture's own contract, exercised over real HTTP.
//
// The Rust watch tests depend on this server telling the truth about two
// things the product's behaviour hinges on:
//   - `/issues` returns PULL REQUESTS as well as issues, each carrying the
//     `pull_request` marker, exactly as api.github.com does. A fixture
//     that quietly omitted them would let an issue watch pass its
//     "never releases a pull request" test against a kinder world than
//     the real one.
//   - nothing is served without the fixture credential.
//
// Run: node --test scripts/fixtures/github/fake-github-server.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const SERVER = fileURLToPath(new URL("./fake-github-server.mjs", import.meta.url));
const TOKEN = "fixture-token";

let child;
let base;
let dir;
let dataPath;

function setWorld(issues, pulls) {
  writeFileSync(dataPath, JSON.stringify({ issues, pulls }));
}

async function get(path, { token = TOKEN } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${base}${path}`, { headers });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "gh-fixture-"));
  dataPath = join(dir, "data.json");
  setWorld([], []);
  child = spawn(process.execPath, [SERVER, "--data", dataPath, "--port", "0"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const line = await new Promise((resolve, reject) => {
    const reader = createInterface({ input: child.stdout });
    reader.once("line", resolve);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`fixture exited ${code}`)));
  });
  base = `http://127.0.0.1:${Number(String(line).trim().replace("LISTEN ", ""))}`;
});

after(() => {
  child?.kill();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("serves the repository's open pull requests", async () => {
  setWorld([], [{ number: 7 }]);
  const { status, body } = await get("/repos/clioo/drogon/pulls?state=open&per_page=100");
  assert.equal(status, 200);
  assert.deepEqual(body.map((p) => p.number), [7]);
  // The pulls endpoint is not polluted by the issue list.
  setWorld([{ number: 9 }], [{ number: 7 }]);
  const pulls = await get("/repos/clioo/drogon/pulls?per_page=100");
  assert.deepEqual(pulls.body.map((p) => p.number), [7]);
});

test("the issues endpoint returns pull requests too, marked as GitHub marks them", async () => {
  setWorld([{ number: 9 }, { number: 11 }], [{ number: 10 }]);
  const { status, body } = await get("/repos/clioo/drogon/issues?per_page=100");
  assert.equal(status, 200);
  // Ascending by number, issues and pull requests interleaved.
  assert.deepEqual(body.map((row) => row.number), [9, 10, 11]);
  const marked = body.filter((row) => row.pull_request != null);
  assert.deepEqual(marked.map((row) => row.number), [10]);
  assert.match(String(marked[0].pull_request.url), /\/pulls\/10$/);
  // ...and a real issue carries no marker at all, so a watch can tell them
  // apart without guessing.
  assert.equal(body.find((row) => row.number === 9).pull_request, undefined);
});

test("refuses both collections without the fixture credential", async () => {
  setWorld([{ number: 9 }], [{ number: 10 }]);
  for (const path of ["/repos/clioo/drogon/issues", "/repos/clioo/drogon/pulls"]) {
    const anonymous = await get(path, { token: "" });
    assert.equal(anonymous.status, 401, `${path} must refuse an anonymous read`);
    const wrong = await get(path, { token: "not-the-token" });
    assert.equal(wrong.status, 401, `${path} must refuse a wrong credential`);
  }
});

test("honours the caller's page bound and 404s anything else", async () => {
  setWorld([{ number: 1 }, { number: 2 }, { number: 3 }], []);
  const paged = await get("/repos/clioo/drogon/issues?per_page=2");
  assert.deepEqual(paged.body.map((row) => row.number), [1, 2]);
  assert.equal((await get("/repos/clioo/drogon/commits")).status, 404);
});
