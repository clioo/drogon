// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/pty-input-write-queue.ts,
// adapted to this repo's confirmed-write contract: the fork's ordinary
// input path is fire-and-forget with a coalescing drain (dense input —
// key auto-repeat, wheel reports — must not pace one round-trip per
// keystroke); this queue keeps the same drain shape but still awaits each
// coalesced batch's `session.write` confirmation so a rejected or
// byte-mismatched write fences the pane exactly as before.

import type { Result } from "../../../../shared/session-contract";

/** Fork parity: TERMINAL_INPUT_COALESCE_MAX_CODE_UNITS. */
export const TERMINAL_INPUT_COALESCE_MAX_CODE_UNITS = 4096;

type PendingInput = { text: string; bytes: number };

export class TerminalInputQueue {
  private pending: PendingInput[] = [];
  private pendingBytes = 0;
  private failed = false;
  private draining: Promise<void> | null = null;
  constructor(
    private send: (text: string) => Promise<Result<{ acceptedBytes: number }>>,
    private writable: () => boolean,
    private report: (message: string) => void,
    private limit = 65536,
  ) {}

  /**
   * Queues input for the drain and returns immediately (fork `sendInput`
   * parity): typing never blocks on a bridge round-trip. Ordering and
   * failure fencing are preserved by the single drain loop; the byte
   * stream the pty receives is identical to uncoalesced writes.
   */
  enqueue(text: string): Promise<void> {
    if (this.failed || !this.writable()) return Promise.resolve();
    const bytes = new TextEncoder().encode(text).length;
    if (bytes + this.pendingBytes > this.limit) {
      this.pause(
        "Too much terminal input is pending. Refresh before sending more.",
      );
      return Promise.resolve();
    }
    this.pending.push({ text, bytes });
    this.pendingBytes += bytes;
    // Microtask start (never synchronous): a writable() flip landing in the
    // same task as the enqueue must still fence the write, and keys typed
    // within one macrotask coalesce from the first one.
    this.draining ??= Promise.resolve()
      .then(() => this.drain())
      .finally(() => {
        this.draining = null;
      });
    return Promise.resolve();
  }

  /** Test/paste seam: resolves when every queued write has settled. */
  async waitForDrain(): Promise<void> {
    while (this.draining) await this.draining;
  }

  private async drain(): Promise<void> {
    while (this.pending.length > 0 && !this.failed) {
      if (!this.writable()) {
        // Pane disposed or daemon unreachable mid-burst: the retry/verdict
        // projection owns the user-facing state; queued keys drop exactly
        // as the pre-coalescing chain dropped them.
        this.pending = [];
        this.pendingBytes = 0;
        return;
      }
      // Coalesce consecutive small items into one write (fork drain):
      // key-repeat and wheel-report bursts reach the pty as one byte
      // stream instead of one round-trip per event.
      let payload = "";
      let bytes = 0;
      while (this.pending.length > 0) {
        const next = this.pending[0];
        const coalescible =
          next.text.length <= TERMINAL_INPUT_COALESCE_MAX_CODE_UNITS;
        if (payload.length > 0) {
          if (
            !coalescible ||
            payload.length + next.text.length >
              TERMINAL_INPUT_COALESCE_MAX_CODE_UNITS
          )
            break;
        }
        payload += next.text;
        bytes += next.bytes;
        this.pending.shift();
        this.pendingBytes -= next.bytes;
        if (!coalescible) break;
      }
      try {
        if (this.failed || !this.writable()) {
          // Requeue is wrong (ordering vs fresher input); drop the peeled
          // batch like the old chain dropped its in-flight item.
          continue;
        }
        const response = await this.send(payload);
        if (!response.ok) this.pause(response.error.message);
        else if (response.result.acceptedBytes !== bytes)
          this.pause(
            "Terminal input was not fully confirmed. Refresh before sending more.",
          );
      } catch {
        this.pause(
          "Terminal input could not be confirmed. Refresh before sending more.",
        );
      }
    }
  }

  private pause(message: string) {
    this.failed = true;
    this.pending = [];
    this.pendingBytes = 0;
    this.report(message);
  }
}
