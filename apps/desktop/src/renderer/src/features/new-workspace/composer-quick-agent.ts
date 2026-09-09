// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/lib/quick-workspace-agent-selection.ts — the fork's
// derive-with-override binding for the quick-create agent: the auto-pick
// derives from the live detected catalog until the user picks (the
// override), a deliberate Blank Terminal (null) is preserved, and a pick
// the catalog later invalidates repairs to the current auto-pick.
import type { Harness, HarnessId } from "../../../../shared/session-contract";
import { initialComposerAgentId } from "./composer-submit";

export type ComposerQuickAgentResolution = {
  quickAgent: HarnessId | null;
  /** The override to write back when the pick was repaired (fork parity). */
  quickAgentOverride: HarnessId | null | undefined;
};

export function resolveComposerQuickAgent(input: {
  quickAgentOverride: HarnessId | null | undefined;
  harnesses: readonly Harness[];
  defaultHarnessId: string;
}): ComposerQuickAgentResolution {
  const { quickAgentOverride, harnesses, defaultHarnessId } = input;
  const preferred = initialComposerAgentId([...harnesses], defaultHarnessId);
  if (quickAgentOverride === undefined || quickAgentOverride === null) {
    return {
      quickAgent: quickAgentOverride === undefined ? preferred : null,
      quickAgentOverride,
    };
  }
  const available = harnesses.some(
    (harness) =>
      harness.harnessId === quickAgentOverride &&
      harness.availability === "available",
  );
  if (available) return { quickAgent: quickAgentOverride, quickAgentOverride };
  return { quickAgent: preferred, quickAgentOverride: preferred };
}
