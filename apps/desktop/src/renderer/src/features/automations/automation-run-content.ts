// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/automation-run-content.ts.
// Adaptation: this repo's run records carry no precheck result or usage
// payload, so those fallback branches have nothing to read and are
// omitted; the saved snapshot and error fallbacks stay literal.
import type { AutomationRunDetail } from "../../../../shared/automation-contract";

export function getAutomationRunContent(run: AutomationRunDetail): string {
  const savedOutput = run.outputSnapshot?.content.trim();
  if (savedOutput) {
    return run.outputSnapshot?.content ?? savedOutput;
  }
  return run.error ?? "No output content available.";
}
