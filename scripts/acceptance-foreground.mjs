import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runAcceptanceProcess,
  startAcceptanceProcess,
  stopAcceptanceProcess,
  waitAcceptanceExit,
} from "./acceptance-process.mjs";

export function verifyForegroundObservation(observation, desktopPids) {
  assert.ok(desktopPids.length > 0, "No desktop process was observed");
  assert.ok(
    observation.sampleCount > 0,
    "OS window observation was unavailable",
  );
  const activated = desktopPids.filter((pid) =>
    observation.activatedPids.includes(pid),
  );
  const visible = desktopPids.filter((pid) =>
    observation.visibleWindowPids.includes(pid),
  );
  assert.deepEqual(
    activated,
    [],
    `Test desktop activated on macOS: ${activated}`,
  );
  assert.deepEqual(
    visible,
    [],
    `Test desktop displayed a native window: ${visible}`,
  );
}

export async function startForegroundObservation(outputDir) {
  assert.equal(
    process.platform,
    "darwin",
    "OS focus verification currently requires macOS",
  );
  const executable = path.join(outputDir, "observe-macos-foreground");
  await runAcceptanceProcess(
    "/usr/bin/swiftc",
    [
      fileURLToPath(
        new URL("./observe-macos-foreground.swift", import.meta.url),
      ),
      "-o",
      executable,
    ],
    { timeout: 60_000 },
  );
  const child = startAcceptanceProcess(executable, [], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr = (stderr + data).slice(-8192);
  });
  child.stdin.on("error", (error) => {
    stderr = (stderr + error.message).slice(-8192);
  });
  try {
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        child.off("error", onError);
        child.off("exit", onExit);
        if (error) reject(error);
        else resolve();
      };
      const onData = () => {
        if (stdout.includes("READY\n")) finish();
      };
      const onError = (error) => finish(error);
      const onExit = () =>
        finish(new Error(`OS observer exited before readiness: ${stderr}`));
      const timer = setTimeout(
        () => finish(new Error("OS observer readiness timed out")),
        10_000,
      );
      child.stdout.on("data", onData);
      child.once("error", onError);
      child.once("exit", onExit);
    });
  } catch (error) {
    await stopAcceptanceProcess(child);
    throw error;
  }
  return {
    async stop() {
      try {
        assert.equal(
          child.exitCode,
          null,
          "OS observer exited before validation finished",
        );
        assert.equal(
          child.signalCode,
          null,
          "OS observer stopped before validation finished",
        );
        child.stdin.end("stop\n");
        const result = await waitAcceptanceExit(child, 5_000);
        assert.equal(result.verdict, "exited", "OS observer did not exit");
        assert.equal(result.code, 0, `OS observer failed: ${stderr}`);
        await closed;
        return JSON.parse(stdout.trim().split("\n").at(-1));
      } finally {
        await stopAcceptanceProcess(child);
      }
    },
  };
}
