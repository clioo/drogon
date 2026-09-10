import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installPrivateAcceptanceEnvironment } from "./acceptance-private-environment.mjs";

test("interactive HOME fallback and daemon override share one private config, without ambient credentials", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "drogon-private-home-"));
  const env = { HOME: "/original-home", PI_CODING_AGENT_DIR: "/original-agent", PATH: "/bin", EXAMPLE_API_KEY: "not-for-the-child", ZDOTDIR: "/original-zsh" };
  const before = { ...env };
  try {
    const installed = await installPrivateAcceptanceEnvironment(fixture, env);
    assert.equal(env.PI_CODING_AGENT_DIR, path.join(env.HOME, ".pi", "agent"));
    assert.equal(env.ZDOTDIR, env.HOME);
    assert.equal(env.PI_OFFLINE, "1");
    assert.equal(env.EXAMPLE_API_KEY, undefined);
    assert.equal(env.PATH, "/bin");
    assert.equal((await stat(installed.piDir)).isDirectory(), true);
    installed.restore(); installed.restore();
    assert.deepEqual(env, before);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
