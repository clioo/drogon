import { describe, expect, test } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
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

describe("awake controller edges", () => {
  test("activity reports while on change nothing: no spawn, no kill", () => {
    const fake = fakeSpawn();
    const awake = new AwakeController({ platform: "darwin", spawn: fake.spawn });
    awake.setMode("on");
    expect(fake.calls).toHaveLength(1);
    awake.setAgentWorking(true);
    awake.setAgentWorking(false);
    expect(fake.calls).toHaveLength(1);
    expect(fake.children[0].killed).toBe(false);
    expect(awake.getSnapshot()).toEqual({ mode: "on", active: true, supported: true });
    awake.dispose();
  });
  test("a kill that throws is swallowed; the mode still reads inactive", () => {
    const fake = fakeSpawn();
    const awake = new AwakeController({
      platform: "darwin",
      spawn: (command, args, options) => {
        const child = fake.spawn(command, args, options);
        fake.children[0].kill = () => {
          throw new Error("ESRCH");
        };
        return child;
      },
    });
    expect(awake.setMode("on").active).toBe(true);
    expect(() => awake.setMode("off")).not.toThrow();
    expect(awake.getSnapshot().active).toBe(false);
  });
  test("dispose in auto releases the held child exactly once", () => {
    const fake = fakeSpawn();
    const awake = new AwakeController({ platform: "darwin", spawn: fake.spawn });
    awake.setMode("auto");
    awake.setAgentWorking(true);
    expect(awake.getSnapshot().active).toBe(true);
    awake.dispose();
    expect(fake.children[0].killed).toBe(true);
    expect(awake.getSnapshot().active).toBe(false);
  });
});
