import { describe, expect, test, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { AwakeController } from "./awake";

function fakeSpawn() {
  const calls: { command: string; args: string[] }[] = [];
  const children: (EventEmitter & { kill: () => boolean; unref: () => void; killed: boolean })[] = [];
  const spawn = (command: string, args: string[], _options: { stdio: "ignore"; windowsHide: true }) => {
    calls.push({ command, args });
    const child = new EventEmitter() as EventEmitter & {
      kill: () => boolean;
      unref: () => void;
      killed: boolean;
    };
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
