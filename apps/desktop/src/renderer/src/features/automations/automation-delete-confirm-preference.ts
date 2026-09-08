// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/automation-delete-confirm-preference.ts.
// Adapter: literal English copy (no i18n); the Settings deep-link is an
// optional callback because this repo has no settings target for the
// toggle yet.
import { toast } from "sonner";

/**
 * Turning off the delete confirmation is a one-click, easily regretted change,
 * so the acknowledgement carries the way back to it rather than just reporting
 * success.
 */
export function persistSkipDeleteAutomationConfirm({
  persist,
  openSettings,
}: {
  persist: () => void;
  openSettings?: () => void;
}): void {
  persist();
  toast.success("We'll skip this confirmation next time.", {
    description: "You can change this in Settings.",
    duration: 8000,
    ...(openSettings
      ? {
          action: {
            label: "Open Settings",
            onClick: openSettings,
          },
        }
      : {}),
  });
}
