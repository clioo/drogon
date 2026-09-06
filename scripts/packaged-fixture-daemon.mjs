import assert from "node:assert/strict";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runAcceptanceProcess } from "./acceptance-process.mjs";

export function packagedFixtureDaemon(binary, cli, dataDir) {
  let owned;
  async function rpc(method, params = {}) {
    const response = JSON.parse(
      (
        await runAcceptanceProcess(cli, [
          "--data-dir",
          dataDir,
          "--json",
          "rpc",
          method,
          "--params",
          JSON.stringify(params),
        ])
      ).stdout,
    );
    assert.equal(response.ok, true);
    return response.result;
  }
  async function owner() {
    const holders = (
      await runAcceptanceProcess("/usr/sbin/lsof", [
        "-t",
        path.join(dataDir, ".drogond.lock"),
      ])
    ).stdout
      .trim()
      .split(/\s+/);
    assert.equal(
      holders.length,
      1,
      "Only one process may own this private fixture lock",
    );
    assert.match(holders[0], /^\d+$/);
    const pid = Number(holders[0]);
    const identity = (
      await runAcceptanceProcess("/bin/ps", [
        "-p",
        String(pid),
        "-o",
        "lstart=",
        "-o",
        "command=",
      ])
    ).stdout.trim();
    assert.ok(
      identity.includes(`${binary} --data-dir ${dataDir}`),
      "Refuse to signal any process outside the exact packaged fixture",
    );
    return { pid, identity };
  }
  return {
    rpc,
    async capture() {
      owned = await owner();
      return owned.pid;
    },
    async stop() {
      if (!owned) await this.capture();
      const { workspaces } = await rpc("workspace.list");
      for (const workspace of workspaces) {
        const { sessions } = await rpc("session.list", {
          workspaceId: workspace.id,
        });
        for (const session of sessions) {
          if (session.verdict === "exited") continue;
          const stopped = await rpc("session.stop", {
            sessionId: session.id,
            incarnation: session.incarnation,
          });
          assert.equal(
            stopped.verdict,
            "exited",
            "Do not stop a fixture daemon with unverified sessions",
          );
        }
      }
      assert.deepEqual(
        await owner(),
        owned,
        "Fixture ownership changed; refusing cleanup",
      );
      process.kill(owned.pid, "SIGTERM");
      for (let i = 0; i < 50; i++) {
        try {
          process.kill(owned.pid, 0);
        } catch (error) {
          if (error.code === "ESRCH") return;
          throw error;
        }
        await delay(100);
      }
      throw new Error(
        "Fixture daemon exit remains unverifiable; no broad or forced cleanup attempted",
      );
    },
  };
}
