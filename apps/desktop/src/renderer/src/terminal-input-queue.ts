import type { Result } from "../../shared/session-contract";

export class TerminalInputQueue {
  private tail = Promise.resolve();
  private pendingBytes = 0;
  private failed = false;
  constructor(
    private send: (text: string) => Promise<Result<{ acceptedBytes: number }>>,
    private writable: () => boolean,
    private report: (message: string) => void,
    private limit = 65536,
  ) {}

  enqueue(text: string): Promise<void> {
    if (this.failed || !this.writable()) return Promise.resolve();
    const bytes = new TextEncoder().encode(text).length;
    if (bytes + this.pendingBytes > this.limit) {
      this.pause(
        "Too much terminal input is pending. Refresh before sending more.",
      );
      return Promise.resolve();
    }
    this.pendingBytes += bytes;
    this.tail = this.tail.then(async () => {
      try {
        if (this.failed || !this.writable()) return;
        const response = await this.send(text);
        if (!response.ok) this.pause(response.error.message);
        else if (response.result.acceptedBytes !== bytes)
          this.pause(
            "Terminal input was not fully confirmed. Refresh before sending more.",
          );
      } catch {
        this.pause(
          "Terminal input could not be confirmed. Refresh before sending more.",
        );
      } finally {
        this.pendingBytes -= bytes;
      }
    });
    return this.tail;
  }

  private pause(message: string) {
    this.failed = true;
    this.report(message);
  }
}
