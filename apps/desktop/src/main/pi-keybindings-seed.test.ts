import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyPiQueueFollowUpSeed,
  PI_FOLLOW_UP_ACTION,
  PI_SUBMIT_ACTION,
  resolvePiAgentDir,
  seedPiQueueFollowUpKeybindings,
} from "./pi-keybindings-seed";

async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "drogon-pi-keys-"));
}

describe("pi queue-follow-up seed", () => {
  test("missing file is created with only the two swapped bindings", async () => {
    const home = await scratch();
    try {
      const result = await seedPiQueueFollowUpKeybindings({}, home);
      expect(result.seeded).toBe(true);
      const parsed = JSON.parse(
        await readFile(
          path.join(home, ".pi", "agent", "keybindings.json"),
          "utf8",
        ),
      );
      expect(parsed).toEqual({
        [PI_SUBMIT_ACTION]: "alt+enter",
        [PI_FOLLOW_UP_ACTION]: "enter",
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("absent keys are filled while explicit user values always win", () => {
    const { next, changed } = applyPiQueueFollowUpSeed({
      [PI_SUBMIT_ACTION]: "enter",
      "tui.input.newLine": "shift+enter",
    });
    expect(changed).toBe(true);
    expect(next[PI_SUBMIT_ACTION]).toBe("enter");
    expect(next[PI_FOLLOW_UP_ACTION]).toBe("enter");
    expect(next["tui.input.newLine"]).toBe("shift+enter");
  });

  test("a fully customized file is left byte-identical", async () => {
    const home = await scratch();
    try {
      const file = path.join(home, ".pi", "agent", "keybindings.json");
      await seedPiQueueFollowUpKeybindings({}, home);
      const before = await readFile(file, "utf8");
      const second = await seedPiQueueFollowUpKeybindings({}, home);
      expect(second.seeded).toBe(false);
      expect(await readFile(file, "utf8")).toBe(before);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("stock explicit values are respected, never rewritten", () => {
    const { next, changed } = applyPiQueueFollowUpSeed({
      [PI_SUBMIT_ACTION]: "enter",
      [PI_FOLLOW_UP_ACTION]: "alt+enter",
    });
    expect(changed).toBe(false);
    expect(next[PI_SUBMIT_ACTION]).toBe("enter");
    expect(next[PI_FOLLOW_UP_ACTION]).toBe("alt+enter");
  });

  test("corrupt json is left untouched", async () => {
    const home = await scratch();
    try {
      const dir = path.join(home, ".pi", "agent");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "keybindings.json"), "{oops");
      const result = await seedPiQueueFollowUpKeybindings({}, home);
      expect(result.seeded).toBe(false);
      expect(
        await readFile(path.join(dir, "keybindings.json"), "utf8"),
      ).toBe("{oops");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("PI_CODING_AGENT_DIR override is honored", () => {
    expect(
      resolvePiAgentDir({ PI_CODING_AGENT_DIR: "/tmp/custom-pi" }, "/home/u"),
    ).toBe("/tmp/custom-pi");
    expect(resolvePiAgentDir({}, "/home/u")).toBe(
      path.join("/home/u", ".pi", "agent"),
    );
  });
});
