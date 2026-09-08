// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/sidebar/delete-worktree-preference-toast.ts.
// Adapter: literal English copy (no i18n); the preference persists to
// Drogon's localStorage analogue and the Settings deep-link is an optional
// callback because this repo has no settings target for the toggle yet.
import { toast } from "sonner";

export function persistDeleteWorktreeConfirmSkipPreference({
  persist,
  openSettings,
}: {
  persist: () => void;
  openSettings?: () => void;
}): void {
  persist();
  // Why: the toast confirms the preference was saved and deep-links to the
  // exact toggle so users can undo a skipped destructive confirmation quickly.
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
