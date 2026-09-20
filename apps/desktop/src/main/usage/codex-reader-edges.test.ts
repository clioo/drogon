import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { describe, expect, test } from "vitest";
import { readCodexUsage, resolveCodexCommand } from "./codex";

type FakeChild = EventEmitter & {
  stdin: { write: (data: string) => void };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => boolean;
};

function controllableChild(stdinWrite: (data: string) => void = () => {}): {
  child: ChildProcess;
  stdout: EventEmitter;
  inner: FakeChild;
} {
  const inner = new EventEmitter() as FakeChild;
  inner.stdin = { write: stdinWrite };
  inner.stdout = new EventEmitter();
  inner.stderr = new EventEmitter();
  inner.kill = () => true;
  return { child: inner as unknown as ChildProcess, stdout: inner.stdout, inner };
}

async function authedHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = await mkdtemp(path.join(tmpdir(), "drogon-codex-edge-"));
  await writeFile(path.join(home, "auth.json"), "{}");
  return { home, cleanup: () => rm(home, { recursive: true, force: true }) };
}

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

function rateLimitsMessage(
  id: number,
  primary: unknown,
  secondary: unknown,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    result: { rateLimits: { primary, secondary } },
  };
}

describe("codex rpc failure decisions", () => {
  test("a usage error from the helper is an error, never numbers", async () => {
    const { home, cleanup } = await authedHome();
    const { child, stdout } = controllableChild();
    try {
      const pending = readCodexUsage({
        codexHome: home,
        resolveCommand: () => Promise.resolve("codex"),
        spawnAppServer: () => child,
      });
      await tick();
      stdout.emit("data", Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id: 1 })}\n`));
      await tick();
      stdout.emit(
        "data",
        Buffer.from(
          `${JSON.stringify({ jsonrpc: "2.0", id: 2, error: { code: -1, message: "bad" } })}\n`,
        ),
      );
      const result = await pending;
      expect(result.status).toBe("error");
      expect(result.error).toMatch(/reported a usage error/);
      expect(result.session).toBeNull();
    } finally {
      await cleanup();
    }
  });
  test("a helper that exits first reports the exit, never hangs", async () => {
    const { home, cleanup } = await authedHome();
    const { child, inner } = controllableChild();
    try {
      const pending = readCodexUsage({
        codexHome: home,
        resolveCommand: () => Promise.resolve("codex"),
        spawnAppServer: () => child,
      });
      await tick();
      inner.emit("close", 1);
      const result = await pending;
      expect(result.status).toBe("error");
      expect(result.error).toMatch(/exited before reporting/);
    } finally {
      await cleanup();
    }
  });
  test("garbage lines are skipped, the first answer wins, late noise is dropped", async () => {
    const { home, cleanup } = await authedHome();
    const { child, stdout, inner } = controllableChild();
    try {
      const pending = readCodexUsage({
        codexHome: home,
        resolveCommand: () => Promise.resolve("codex"),
        spawnAppServer: () => child,
      });
      await tick();
      stdout.emit("data", Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id: 1 })}\n`));
      await tick();
      stdout.emit("data", Buffer.from("this is not json\n\n"));
      stdout.emit(
        "data",
        Buffer.from(
          `${JSON.stringify(rateLimitsMessage(2, { usedPercent: 25, windowDurationMins: 300 }, { usedPercent: 60, windowDurationMins: 10080 }))}\n`,
        ),
      );
      const result = await pending;
      expect(result.status).toBe("ok");
      expect(result.session?.usedPercent).toBe(25);
      // Late duplicate answers and the exit after settle change nothing:
      // the child is killed exactly once, at settle time.
      let postKills = 0;
      const settledKill = inner.kill;
      inner.kill = () => {
        postKills += 1;
        return settledKill();
      };
      stdout.emit(
        "data",
        Buffer.from(
          `${JSON.stringify(rateLimitsMessage(2, { usedPercent: 99, windowDurationMins: 300 }, null))}\n`,
        ),
      );
      inner.emit("close", 0);
      await tick();
      expect(result.session?.usedPercent).toBe(25);
      expect(postKills).toBe(0);
    } finally {
      await cleanup();
    }
  });
  test("an unwritable helper is a talk error, not a hang", async () => {
    const { home, cleanup } = await authedHome();
    const { child } = controllableChild(() => {
      throw new Error("EPIPE");
    });
    try {
      const result = await readCodexUsage({
        codexHome: home,
        resolveCommand: () => Promise.resolve("codex"),
        spawnAppServer: () => child,
      });
      expect(result.status).toBe("error");
      expect(result.error).toMatch(/Could not talk to the Codex helper/);
    } finally {
      await cleanup();
    }
  });
  test("a spawn throw is a start error; ENOENT is unavailable", async () => {
    const { home, cleanup } = await authedHome();
    try {
      const thrown = await readCodexUsage({
        codexHome: home,
        resolveCommand: () => Promise.resolve("codex"),
        spawnAppServer: () => {
          throw new Error("spawn EACCES");
        },
      });
      expect(thrown.status).toBe("error");
      expect(thrown.error).toMatch(/Could not start the Codex helper/);
      const enoent = controllableChild();
      const pending = readCodexUsage({
        codexHome: home,
        resolveCommand: () => Promise.resolve("codex"),
        spawnAppServer: () => enoent.child,
      });
      await tick();
      const error = new Error("spawn ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      enoent.inner.emit("error", error);
      const missing = await pending;
      expect(missing.status).toBe("unavailable");
      expect(missing.error).toMatch(/not found/);
      const other = controllableChild();
      const pendingOther = readCodexUsage({
        codexHome: home,
        resolveCommand: () => Promise.resolve("codex"),
        spawnAppServer: () => other.child,
      });
      await tick();
      const eacces = new Error("spawn EACCES") as NodeJS.ErrnoException;
      eacces.code = "EACCES";
      other.inner.emit("error", eacces);
      const denied = await pendingOther;
      expect(denied.status).toBe("error");
      expect(denied.error).toMatch(/Could not start/);
    } finally {
      await cleanup();
    }
  });
});

describe("codex command resolution (PATH scan)", () => {
  test("finds an executable codex, skipping blanks and non-runnable files", async () => {
    const bin = await mkdtemp(path.join(tmpdir(), "drogon-codex-bin-"));
    const dead = await mkdtemp(path.join(tmpdir(), "drogon-codex-dead-"));
    try {
      const exe = path.join(bin, "codex");
      await writeFile(exe, "#!/bin/sh\nexit 0\n");
      await chmod(exe, 0o755);
      await writeFile(path.join(dead, "codex"), "not executable");
      const pathEnv = `::${dead}  :${bin}:`;
      await expect(resolveCodexCommand(pathEnv)).resolves.toBe(exe);
      await expect(resolveCodexCommand(dead)).resolves.toBeNull();
    } finally {
      await rm(bin, { recursive: true, force: true });
      await rm(dead, { recursive: true, force: true });
    }
  });
});
