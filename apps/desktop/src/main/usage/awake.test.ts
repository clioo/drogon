import { describe, expect, test, vi } from "vitest";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AwakeController } from "./awake";

function fakeSpawn() {
  const calls: { command: string; args: string[] }[] = [];
  const children: (EventEmitter & { pid?: number; kill: () => boolean; unref: () => void; killed: boolean })[] = [];
  const spawn = (command: string, args: string[], _options: { stdio: "ignore"; windowsHide: true }) => {
    calls.push({ command, args });
    const child = new EventEmitter() as EventEmitter & {
      pid?: number;
      kill: () => boolean;
      unref: () => void;
      killed: boolean;
    };
    child.pid = 42000 + children.length;
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      return true;
    };
    child.unref = () => {};
    children.push(child);
    return child as unknown as ChildProcess;
  };
  return { calls, children, spawn };
}

describe("awake controller", () => {
  test("on spawns exactly one caffeinate, off kills only that child", () => {
    const fake = fakeSpawn();
    const awake = new AwakeController({ platform: "darwin", spawn: fake.spawn });
    expect(awake.getSnapshot()).toEqual({ mode: "off", active: false, supported: true });
    awake.setMode("on");
    awake.setMode("on");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toEqual({ command: "/usr/bin/caffeinate", args: ["-i", "-s"] });
    expect(awake.getSnapshot().active).toBe(true);
    const owned = fake.children[0];
    awake.setMode("off");
    expect(owned.killed).toBe(true);
    expect(awake.getSnapshot()).toEqual({ mode: "off", active: false, supported: true });
  });
  test.each([undefined, 0, -1, NaN, Infinity, 1.5])(
    "never activates or signals a spawn handle with invalid pid %s",
    (pid) => {
      const fake = fakeSpawn();
      const awake = new AwakeController({
        platform: "darwin",
        spawn: (command, args, options) => {
          const child = fake.spawn(command, args, options);
          fake.children[0].pid = pid;
          return child;
        },
      });
      const started = awake.setMode("on");
      awake.setMode("off");
      awake.dispose();
      expect(started.active).toBe(false);
      expect(fake.children[0].killed).toBe(false);
      // Failed spawns still need an error listener, even when not owned.
      fake.children[0].emit("error", new Error("spawn rejected"));
    },
  );

  test.each([undefined, 0, 99999])(
    "does not signal an owned handle whose pid changed to %s",
    (pid) => {
      const fake = fakeSpawn();
      const awake = new AwakeController({ platform: "darwin", spawn: fake.spawn });
      expect(awake.setMode("on").active).toBe(true);
      fake.children[0].pid = pid;
      awake.setMode("off");
      expect(fake.children[0].killed).toBe(false);
    },
  );

  test("late events from a stopped child cannot clear its replacement", () => {
    const fake = fakeSpawn();
    const awake = new AwakeController({ platform: "darwin", spawn: fake.spawn });
    awake.setMode("on");
    awake.setMode("off");
    awake.setMode("on");
    fake.children[0].emit("error", new Error("late spawn error"));
    fake.children[0].emit("exit", 1, null);
    expect(awake.getSnapshot().active).toBe(true);
    expect(fake.children[1].killed).toBe(false);
    awake.dispose();
    expect(fake.children[1].killed).toBe(true);
  });

  test("rapid auto toggles never signal a real failed-spawn handle", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "drogon-awake-"));
    const kill = vi.fn(() => false);
    let closed: Promise<void> | undefined;
    let child: ChildProcess | undefined;
    let spawnError: NodeJS.ErrnoException | undefined;
    const awake = new AwakeController({
      platform: "darwin",
      spawn: (_command, args, options) => {
        child = nodeSpawn(path.join(directory, "absent-executable"), args, {
          ...options,
          env: { HOME: directory, PATH: "/usr/bin:/bin" },
        });
        closed = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("failed-spawn handle did not close")), 5000);
          child!.once("close", () => { clearTimeout(timer); resolve(); });
        });
        child.once("error", (error) => { spawnError = error; });
        // Keep the regression safe even against the unfixed implementation.
        child.kill = kill;
        return child;
      },
    });
    try {
      awake.setMode("auto");
      const working = awake.setAgentWorking(true);
      awake.setAgentWorking(false);
      await closed;
      expect(spawnError?.code).toBe("ENOENT");
      expect(child?.pid).toBeUndefined();
      expect(kill).not.toHaveBeenCalled();
      expect(working.active).toBe(false);
      expect(awake.getSnapshot().active).toBe(false);
    } finally {
      awake.dispose();
      if (closed) await closed;
      await rm(directory, { recursive: true });
    }
  });

  test("an exited child reads inactive without spawning again until toggled", () => {
    const fake = fakeSpawn();
    const awake = new AwakeController({ platform: "darwin", spawn: fake.spawn });
    awake.setMode("on");
    fake.children[0].emit("exit", 0, null);
    expect(awake.getSnapshot().active).toBe(false);
    awake.setMode("off");
    expect(fake.children[0].killed).toBe(false);
  });
  test("off macOS the mode is remembered but nothing spawns", () => {
    const fake = fakeSpawn();
    const spawnSpy = vi.fn(fake.spawn);
    const awake = new AwakeController({ platform: "linux", spawn: spawnSpy });
    awake.setMode("on");
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(awake.getSnapshot()).toEqual({ mode: "on", active: false, supported: false });
  });
  test("a spawn throw fails closed to inactive", () => {
    const awake = new AwakeController({
      platform: "darwin",
      spawn: () => {
        throw new Error("nope");
      },
    });
    expect(awake.setMode("on").active).toBe(false);
  });

  // R16-AY2 auto mode: the assertion is held exactly while an agent works.
  test("auto holds the child only while an agent session is working", () => {
    const fake = fakeSpawn();
    const awake = new AwakeController({ platform: "darwin", spawn: fake.spawn });
    const started = awake.setMode("auto");
    expect(started).toEqual({ mode: "auto", active: false, supported: true });
    expect(fake.calls).toHaveLength(0);
    // An agent starts working: spawn; repeated reports never double-spawn.
    awake.setAgentWorking(true);
    awake.setAgentWorking(true);
    expect(fake.calls).toHaveLength(1);
    expect(awake.getSnapshot().active).toBe(true);
    // Idle again: the child is released.
    const idle = awake.setAgentWorking(false);
    expect(idle.active).toBe(false);
    expect(fake.children[0].killed).toBe(true);
    // Working again re-arms with a fresh child.
    awake.setAgentWorking(true);
    expect(fake.calls).toHaveLength(2);
    expect(awake.getSnapshot().active).toBe(true);
  });

  test("auto ignores acting on activity reports while off; on→auto never flickers", () => {
    const fake = fakeSpawn();
    const awake = new AwakeController({ platform: "darwin", spawn: fake.spawn });
    awake.setAgentWorking(true); // report while off: remembered, not acted on
    expect(fake.calls).toHaveLength(0);
    awake.setMode("on");
    expect(fake.calls).toHaveLength(1);
    awake.setMode("auto");
    // on→auto with a working agent keeps the assertion held (no flicker); a
    // stale report self-corrects within one watcher poll.
    expect(awake.getSnapshot().active).toBe(true);
    awake.setMode("off");
    expect(awake.getSnapshot().active).toBe(false);
  });

  test("switching auto→off while working kills the child; on→auto keeps holding", () => {
    const fake = fakeSpawn();
    const awake = new AwakeController({ platform: "darwin", spawn: fake.spawn });
    awake.setMode("auto");
    awake.setAgentWorking(true);
    awake.setMode("off");
    expect(fake.children[0].killed).toBe(true);
    // on → auto keeps holding: on already owns the assertion and the agent is
    // still reported working.
    awake.setMode("on");
    expect(fake.calls).toHaveLength(2);
    const second = fake.children[1];
    awake.setMode("auto");
    expect(second.killed).toBe(false);
    expect(awake.getSnapshot().active).toBe(true);
  });
});
