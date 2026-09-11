// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
 * The persisted Bot-card disclosure envelope (source: Orca's sidebar keeps
 * `collapsedGroups` in the persisted UI state and writes it back on every
 * toggle). These cases pin the guards that make it safe to read back: a
 * tampered/corrupt store must read as "no overrides", never as a source of
 * invented or broken card state. */

import { beforeEach, describe, expect, it } from "vitest";
import {
  BOT_CARD_EXPANSION_STORAGE_KEY,
  clearBotCardExpansion,
  loadBotCardExpansion,
  saveBotCardExpansion,
} from "./bot-card-expansion-preference";

beforeEach(() => {
  clearBotCardExpansion();
});

describe("bot card expansion preference", () => {
  it("round-trips explicit overrides", () => {
    saveBotCardExpansion({ "bot-1": true, "bot-2": false });
    expect(loadBotCardExpansion()).toEqual({ "bot-1": true, "bot-2": false });
  });

  it("reads an absent envelope as no overrides", () => {
    localStorage.removeItem(BOT_CARD_EXPANSION_STORAGE_KEY);
    expect(loadBotCardExpansion()).toEqual({});
  });

  it("treats a corrupt envelope as no overrides instead of trusting it", () => {
    localStorage.setItem(BOT_CARD_EXPANSION_STORAGE_KEY, "{not json");
    expect(loadBotCardExpansion()).toEqual({});
    localStorage.setItem(BOT_CARD_EXPANSION_STORAGE_KEY, JSON.stringify(["bot-1"]));
    expect(loadBotCardExpansion()).toEqual({});
    localStorage.setItem(BOT_CARD_EXPANSION_STORAGE_KEY, JSON.stringify(null));
    expect(loadBotCardExpansion()).toEqual({});
  });

  it("drops non-boolean values rather than inventing a disclosure", () => {
    localStorage.setItem(
      BOT_CARD_EXPANSION_STORAGE_KEY,
      JSON.stringify({ "bot-1": true, "bot-2": "collapsed", "bot-3": 1 }),
    );
    expect(loadBotCardExpansion()).toEqual({ "bot-1": true });
  });

  it("bounds the envelope, keeping the newest entries", () => {
    const overrides: Record<string, boolean> = {};
    for (let index = 0; index < 600; index += 1) {
      overrides[`bot-${index}`] = index % 2 === 0;
    }
    saveBotCardExpansion(overrides);
    const stored = loadBotCardExpansion();
    expect(Object.keys(stored)).toHaveLength(512);
    expect(stored["bot-599"]).toBe(false);
    expect(stored["bot-0"]).toBeUndefined();
  });

  it("never throws when the store refuses to write", () => {
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(() => saveBotCardExpansion({ "bot-1": true }, refusing)).not.toThrow();
    expect(loadBotCardExpansion(null)).toEqual({});
  });
});
