// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/terminal-pane/osc52-clipboard-toast.ts.
// Adapter: literal English copy (no i18n); the blocked toast's "Open
// Setting" deep-link is dropped because this repo has no settings target
// for the OSC 52 row yet — the 12s info toast still names the setting.
import { toast } from "sonner";

let hasShownOsc52ClipboardBlockedToast = false;
let hasShownOsc52ClipboardFailedToast = false;

export function showOsc52ClipboardBlockedToast(): void {
  if (hasShownOsc52ClipboardBlockedToast) {
    return;
  }

  toast.info("Terminal clipboard write blocked", {
    description:
      "Enable TUI clipboard writes in Terminal settings to copy from SSH, Zellij, tmux, Neovim, fzf, or Grok.",
    duration: 12_000,
  });
  // Why latch after: a throw above would otherwise burn the session's one notice
  // without ever showing it, leaving the opted-out user with silent failures.
  hasShownOsc52ClipboardBlockedToast = true;
}

export function showOsc52ClipboardFailedToast(): void {
  if (hasShownOsc52ClipboardFailedToast) {
    return;
  }

  toast.error("Terminal clipboard copy could not be confirmed", {
    description:
      "The terminal app requested a copy, but Orca could not confirm that it reached the system clipboard.",
    duration: 12_000,
  });
  // Why latch after: same as blocked — don't burn the session notice on a throw.
  hasShownOsc52ClipboardFailedToast = true;
}
