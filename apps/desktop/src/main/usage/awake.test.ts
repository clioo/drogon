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
});
