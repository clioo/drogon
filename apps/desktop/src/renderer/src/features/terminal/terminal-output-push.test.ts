import { describe, expect, it } from "vitest";
import {
  OUTPUT_PUSH_CAPABILITY,
  OUTPUT_PUSH_WAIT_MS,
  createOrderedTerminalWriter,
  decodeBase64ToBytes,
  isOutputPushAvailable,
  isTransientHoldRefusal,
  resolveOutputChannel,
} from "./terminal-output-push";

function legacyDecode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

describe("isOutputPushAvailable", () => {
  it("gates on the exact advertised capability", () => {
    expect(isOutputPushAvailable([OUTPUT_PUSH_CAPABILITY])).toBe(true);
    expect(isOutputPushAvailable(["session.pty.v1", "session.cursor-read.v1"])).toBe(false);
    expect(isOutputPushAvailable([])).toBe(false);
    expect(isOutputPushAvailable(undefined)).toBe(false);
    expect(isOutputPushAvailable(null)).toBe(false);
  });
});

describe("resolveOutputChannel", () => {
  const base = {
    capabilities: [OUTPUT_PUSH_CAPABILITY],
    pushLatchedOff: false,
    readOutputAvailable: true,
    visible: true,
    seeking: false,
  };

  it("pushes for a visible, caught-up pane on a capable daemon", () => {
    expect(resolveOutputChannel(base)).toBe("push");
  });

  it("keeps the old poll as the fallback for an old daemon", () => {
    // Capability-absent: today's 24/120 ms cadence still delivers output.
    expect(resolveOutputChannel({ ...base, capabilities: [] })).toBe("poll");
    expect(resolveOutputChannel({ ...base, capabilities: undefined })).toBe("poll");
    // New desktop against an old preload without the bridge member.
    expect(resolveOutputChannel({ ...base, readOutputAvailable: false })).toBe("poll");
    // A method_not_found at runtime latches the fallback off permanently.
    expect(resolveOutputChannel({ ...base, pushLatchedOff: true })).toBe("poll");
  });

  it("holds no long-poll while hidden or seeking", () => {
    expect(resolveOutputChannel({ ...base, visible: false })).toBe("poll");
    expect(resolveOutputChannel({ ...base, seeking: true })).toBe("poll");
  });
});

describe("isTransientHoldRefusal", () => {
  it("treats only hold_cap as transient capacity, never a version gap", () => {
    expect(isTransientHoldRefusal("hold_cap")).toBe(true);
    expect(isTransientHoldRefusal("method_not_found")).toBe(false);
    expect(isTransientHoldRefusal("unverifiable")).toBe(false);
    expect(isTransientHoldRefusal(undefined)).toBe(false);
  });
});

describe("OUTPUT_PUSH_WAIT_MS", () => {
  it("sits under main's 10 s idle socket timeout", () => {
    expect(OUTPUT_PUSH_WAIT_MS).toBeLessThan(10_000);
    expect(OUTPUT_PUSH_WAIT_MS).toBeGreaterThan(0);
  });
});

describe("decodeBase64ToBytes", () => {
  it("decodes the empty page to no bytes", () => {
    expect([...decodeBase64ToBytes("")]).toEqual([]);
  });

  it("decodes padded and unpadded quanta", () => {
    expect([...decodeBase64ToBytes("Zg==")]).toEqual([102]);
    expect([...decodeBase64ToBytes("Zm8=")]).toEqual([102, 111]);
    expect([...decodeBase64ToBytes("Zm9v")]).toEqual([102, 111, 111]);
    expect([...decodeBase64ToBytes("Zm9vYg==")]).toEqual([102, 111, 111, 98]);
    expect([...decodeBase64ToBytes("Zm9vYmFy")]).toEqual([102, 111, 111, 98, 97, 114]);
  });

  it("matches the legacy atob decode on binary-heavy bytes", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i;
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const base64 = btoa(binary);
    expect(decodeBase64ToBytes(base64)).toEqual(bytes);
    expect(decodeBase64ToBytes(base64)).toEqual(legacyDecode(base64));
  });

  it("matches the legacy decode on a full 64 KiB page of random bytes", () => {
    const bytes = new Uint8Array(65_536);
    let state = 0x12345678;
    for (let i = 0; i < bytes.length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      bytes[i] = state & 0xff;
    }
    const base64 = Buffer.from(bytes).toString("base64");
    expect(decodeBase64ToBytes(base64)).toEqual(bytes);
    expect(decodeBase64ToBytes(base64)).toEqual(legacyDecode(base64));
  });

  it("rejects corrupt input instead of writing corrupt bytes", () => {
    expect(() => decodeBase64ToBytes("Zg=")).toThrow();
    expect(() => decodeBase64ToBytes("Zm9v!")).toThrow();
    expect(() => decodeBase64ToBytes("Zm=v")).toThrow();
    expect(() => decodeBase64ToBytes("Zg===").slice(0)).toThrow();
    // Non-Latin1 codes must throw, never decode to zeros.
    expect(() => decodeBase64ToBytes("Zm9v💩")).toThrow();
    expect(() => decodeBase64ToBytes("Zh==")).toThrow();
  });
});

describe("createOrderedTerminalWriter", () => {
  it("keeps xterm writes strictly ordered across overlapping reads", async () => {
    const landed: number[] = [];
    const writer = createOrderedTerminalWriter(async (bytes) => {
      const id = bytes[0]!;
      // The head write parses slowly while later reads overlap it; without
      // the chain their writes would interleave. A serial chain can only
      // ever have its head in flight, so varying durations — not reverse
      // settling — is what proves the order holds.
      await new Promise((resolve) => setTimeout(resolve, id === 1 ? 50 : 0));
      landed.push(id);
    });
    await Promise.all([1, 2, 3, 4, 5].map((id) => writer(new Uint8Array([id]))));
    expect(landed).toEqual([1, 2, 3, 4, 5]);
  });

  it("preserves a multi-megabyte flood with no drops or duplicates", async () => {
    const seen: number[] = [];
    const writer = createOrderedTerminalWriter(async (bytes) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 2));
      for (const byte of bytes) seen.push(byte);
    });
    const chunks: Uint8Array[] = [];
    for (let c = 0; c < 40; c++) {
      const chunk = new Uint8Array(1024);
      for (let i = 0; i < chunk.length; i++) chunk[i] = (c + i) & 0xff;
      chunks.push(chunk);
    }
    await Promise.all(chunks.map((chunk) => writer(chunk)));
    const expected = chunks.flatMap((chunk) => [...chunk]);
    expect(seen).toEqual(expected);
  });

  it("does not wedge later writes behind a failed one", async () => {
    const landed: string[] = [];
    const writer = createOrderedTerminalWriter(async (bytes) => {
      const text = new TextDecoder().decode(bytes);
      if (text === "bad") throw new Error("xterm write failed");
      landed.push(text);
    });
    await expect(writer(new TextEncoder().encode("bad"))).rejects.toThrow();
    await writer(new TextEncoder().encode("good"));
    expect(landed).toEqual(["good"]);
  });
});
