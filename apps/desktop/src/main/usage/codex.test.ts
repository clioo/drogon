import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { describe, expect, test } from "vitest";
import { readCodexUsage, resolveCodexCommand } from "./codex";

function fakeAppServer(messages: unknown[]): ChildProcess {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { write: (data: string) => void };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => boolean;
  };
  const written: string[] = [];
  child.stdin = {
    write: (data: string) => {
      written.push(data);
      // Answer initialize then rateLimits like the real app-server would.
      const last = data.trim().split("\n").pop() ?? "";
      let id: number | undefined;
      try {
        id = (JSON.parse(last) as { id?: number }).id;
      } catch {
        return;
      }
      if (id === undefined) return;
      queueMicrotask(() => {
        if (id === 1) {
          child.emit("stdout-data", Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id })}\n`));
          return;
        }
        const next = messages.shift();
        if (next === undefined) return;
        child.emit("stdout-data", Buffer.from(`${JSON.stringify(next)}\n`));
      });
    },
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  // Route our synthetic stdout-data events to the stdout emitter the probe listens on.
  child.on("stdout-data", (chunk: Buffer) => child.stdout.emit("data", chunk));
  return child as unknown as ChildProcess;
}

describe("codex usage reader (fail closed)", () => {
  test("missing auth file resolves unavailable without spawning", async () => {
    let spawned = 0;
    const result = await readCodexUsage({
      codexHome: "/nonexistent-codex-home-r1a",
      spawnAppServer: () => {
        spawned += 1;
        throw new Error("must not spawn");
      },
    });
    expect(spawned).toBe(0);
    expect(result).toMatchObject({ provider: "codex", status: "unavailable" });
    expect(result.error).toMatch(/not signed in/i);
  });
  test("missing CLI resolves unavailable", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "drogon-codex-"));
    await writeFile(path.join(home, "auth.json"), "{}");
    try {
      const result = await readCodexUsage({
        codexHome: home,
        resolveCommand: () => Promise.resolve(null),
      });
      expect(result.status).toBe("unavailable");
      expect(result.error).toMatch(/not found/i);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  test("reads session + weekly windows over read-only RPC", async () => {
    // Hermetic auth presence: a temp CODEX_HOME with an (empty) auth.json.
    const home = await mkdtemp(path.join(tmpdir(), "drogon-codex-"));
    await writeFile(path.join(home, "auth.json"), "{}");
    const rateLimits = {
      jsonrpc: "2.0",
      id: 2,
      result: {
        rateLimits: {
          primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1780000000 },
          secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: 1780000000 },
        },
      },
    };
    try {
      const result = await readCodexUsage({
        codexHome: home,
        resolveCommand: () => Promise.resolve("codex"),
        spawnAppServer: () => fakeAppServer([rateLimits]),
      });
      expect(result.status).toBe("ok");
      expect(result.session?.usedPercent).toBe(25);
      expect(result.weekly?.usedPercent).toBe(60);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("codex command resolution", () => {
  test("returns null on an empty PATH", async () => {
    await expect(resolveCodexCommand("")).resolves.toBeNull();
  });
});
