// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/lib/quick-workspace-agent-selection.test.ts (#355: the
// global composer must bind the quick agent like the fork — the live
// auto-pick until the user picks, explicit Blank Terminal preserved, an
// invalidated pick repaired).
import { describe, expect, test } from "vitest";
import type { Harness, HarnessId } from "../../../../shared/session-contract";
import { resolveComposerQuickAgent } from "./composer-quick-agent";

function harness(
  harnessId: HarnessId,
  availability: Harness["availability"] = "available",
): Harness {
  return { harnessId, displayName: harnessId, availability, executable: null };
}

describe("resolveComposerQuickAgent", () => {
  test("no override derives the live auto-pick, even when the catalog arrives late", () => {
    expect(
      resolveComposerQuickAgent({ quickAgentOverride: undefined, harnesses: [], defaultHarnessId: "" }),
    ).toEqual({ quickAgent: null, quickAgentOverride: undefined });
    expect(
      resolveComposerQuickAgent({
        quickAgentOverride: undefined,
        harnesses: [harness("claude"), harness("pi")],
        defaultHarnessId: "",
      }),
    ).toEqual({ quickAgent: "claude", quickAgentOverride: undefined });
  });

  test("the stored default wins over the auto-pick order while available", () => {
    expect(
      resolveComposerQuickAgent({
        quickAgentOverride: undefined,
        harnesses: [harness("claude"), harness("pi")],
        defaultHarnessId: "pi",
      }).quickAgent,
    ).toBe("pi");
  });

  test("an explicit Blank Terminal pick (null override) is preserved", () => {
    expect(
      resolveComposerQuickAgent({
        quickAgentOverride: null,
        harnesses: [harness("claude")],
        defaultHarnessId: "",
      }),
    ).toEqual({ quickAgent: null, quickAgentOverride: null });
  });

  test("a user pick wins over the auto-pick", () => {
    expect(
      resolveComposerQuickAgent({
        quickAgentOverride: "pi",
        harnesses: [harness("claude"), harness("pi")],
        defaultHarnessId: "",
      }).quickAgent,
    ).toBe("pi");
  });

  test("a pick the catalog later invalidates repairs to the current auto-pick", () => {
    expect(
      resolveComposerQuickAgent({
        quickAgentOverride: "pi",
        harnesses: [harness("pi", "missing"), harness("claude")],
        defaultHarnessId: "",
      }),
    ).toEqual({ quickAgent: "claude", quickAgentOverride: "claude" });
    // Nothing available at all: the repair lands on Blank Terminal, not on
    // an agent the catalog does not list.
    expect(
      resolveComposerQuickAgent({
        quickAgentOverride: "pi",
        harnesses: [],
        defaultHarnessId: "",
      }),
    ).toEqual({ quickAgent: null, quickAgentOverride: null });
  });
});
