/* MIT Copyright (c) 2026 Lovecast Inc.
 * Source: terminal-shortcut-policy.ts's Shift+Enter branch and the direct
 * modified-Enter release guard in terminal-keyboard-runtime.ts. No global
 * shortcuts or protocol advertisements: only this xterm's input is claimed.
 *
 * Pi (0.85.1, verified in @earendil-works/pi-coding-agent bundle): its
 * NATIVE_SHIFT_ENTER_SEQUENCE is CSI-u (`ESC[13;2u`), accepted as
 * shift+enter whether or not kitty negotiated (parseKitty checked first).
 * When kitty is inactive, legacy `ESC CR` parses as alt+enter which
 * submits directly in idle via followUp/onSubmit, and bare LF inserts
 * newline via the editor raw-data branch in both kitty states (never
 * submits) — per the adversarial review of PR #406 — so a Pi pane
 * whose tracker lost its push (snapshot reset / truncated replay / boot
 * race) must still send CSI-u. Shell keeps source parity (negotiated
 * CSI-u, else Alt-Enter fallback) because plain shells do not accept CSI-u. */
export function createTerminalShiftEnterHandler(getKittyFlags: () => number, sendInput: (data: string) => void, options?: { forceCsiU?: boolean }) {
  const forceCsiU = options?.forceCsiU === true;
  let claimedCode: string | null = null;
  return (event: KeyboardEvent): boolean => {
    const code = event.code || "Enter";
    if ((event.type === "keyup" || event.type === "keypress") && event.key === "Enter" && code === claimedCode) {
      if (event.type === "keyup") claimedCode = null;
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (event.type !== "keydown" || event.key !== "Enter" || !event.shiftKey
      || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.keyCode === 229) return false;
    claimedCode = code;
    event.preventDefault();
    event.stopPropagation();
    // Pi always takes CSI-u (its native sequence, valid with or without
    // negotiated kitty). Shell preserves source negotiation (CSI-u only
    // when the PTY proved kitty, else the Alt-Enter fallback).
    sendInput(forceCsiU || getKittyFlags() > 0 ? "\x1b[13;2u" : "\x1b\r");
    return true;
  };
}
