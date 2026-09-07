import { describe, expect, it } from "vitest";
import {
  BOT_CHARACTERS,
  botCharacterLabel,
  botDisplayName,
} from "./bot-characters";

describe("bot-characters", () => {
  it("has 17 presets, all distinct, excluding 'none'", () => {
    expect(BOT_CHARACTERS).toHaveLength(17);
    expect(new Set(BOT_CHARACTERS.map((c) => c.value)).size).toBe(17);
    expect(BOT_CHARACTERS.some((c) => (c.value as string) === "none")).toBe(
      false,
    );
  });

  it("looks up a label by preset value", () => {
    expect(botCharacterLabel("arya")).toBe("Arya Stark");
    expect(botCharacterLabel("none")).toBeNull();
    expect(botCharacterLabel("no-such-preset")).toBeNull();
  });

  it("falls back from a blank name to the preset's label", () => {
    expect(botDisplayName("", "arya")).toBe("Arya Stark");
    expect(botDisplayName("   ", "tyrion")).toBe("Tyrion Lannister");
    expect(botDisplayName("Custom Name", "arya")).toBe("Custom Name");
    expect(botDisplayName("", "none")).toBe("");
  });
});
