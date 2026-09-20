// The fixture must find its own default dataset from wherever it is
// checked out. It resolved that path with `new URL(...).pathname`, which
// keeps the %20 of a directory containing a space, so every `jira_*` Rust
// test failed in a checkout under a path like "Application Support" —
// which is exactly where Drogon's own worktrees live.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Copies the fixture under `dir`, starts it with no --data, returns its port. */
async function listenFrom(t, dir) {
  mkdirSync(dir, { recursive: true });
  cpSync(path.join(here, 'fake-jira-server.mjs'), path.join(dir, 'fake-jira-server.mjs'));
  cpSync(path.join(here, 'data'), path.join(dir, 'data'), { recursive: true });

  const child = spawn(process.execPath, [path.join(dir, 'fake-jira-server.mjs'), '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Teardown runs on pass, failure and timeout alike.
  t.after(() => {
    child.kill('SIGKILL');
    return new Promise((resolve) => child.on('close', resolve));
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((_, reject) =>
    child.on('exit', (code) => reject(new Error(`fixture exited with ${code}: ${stderr.trim()}`))),
  );
  const listening = (async () => {
    for await (const line of readline.createInterface({ input: child.stdout })) {
      const port = /^LISTEN (\d+)$/.exec(line.trim())?.[1];
      if (port) return Number(port);
    }
    throw new Error(`fixture never printed LISTEN: ${stderr.trim()}`);
  })();
  return Promise.race([listening, exited]);
}

async function myself(port) {
  const response = await fetch(`http://127.0.0.1:${port}/rest/api/3/myself`, {
    headers: { authorization: 'Bearer fixture-token' },
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('serves its default dataset from a directory whose path contains a space', async (t) => {
  const base = mkdtempSync(path.join(tmpdir(), 'fake-jira-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const port = await listenFrom(t, path.join(base, 'Application Support', 'jira fixture'));
  const viewer = await myself(port);
  assert.ok(viewer.accountId, `the default dataset loaded: ${JSON.stringify(viewer)}`);
});

test('still serves its default dataset from a path with no space', async (t) => {
  const base = mkdtempSync(path.join(tmpdir(), 'fake-jira-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const port = await listenFrom(t, path.join(base, 'plain'));
  const viewer = await myself(port);
  assert.ok(viewer.accountId, `the default dataset loaded: ${JSON.stringify(viewer)}`);
});
