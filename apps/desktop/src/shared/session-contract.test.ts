// session-contract.ts is a types-only module: at runtime it is erased, so no
// behavioural test can reach it. What can be held is that the contract and
// its runtime twin — the zod schemas in result-validation.ts, which is what
// actually accepts or rejects a daemon payload — agree about the fields the
// renderer depends on. A field declared in one and missing from the other is
// how a payload silently stops reaching the code that needs it.
// Additive observed-harness fields of `session-contract.ts` (issue #622)
// are pinned the same way: the declaration is read as source text and
// matched with a regex — esbuild erases types, so no runtime test can reach
// `Session["observedHarnessId"]` / `Session["observedHarnessAt"]` directly —
// and the runtime twin must accept a payload carrying both fields.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { resultSchemas } from "./result-validation";

const contractSource = fs.readFileSync(
  new URL("./session-contract.ts", import.meta.url),
  "utf8",
);

const validSession = {
  id: "s1",
  workspaceId: "w1",
  hostId: "h1",
  incarnation: "i1",
  command: "/bin/zsh",
  args: [],
  cols: 80,
  rows: 24,
  verdict: "live",
  exitCode: null,
  createdAt: new Date(0).toISOString(),
};

describe("Session gridCursor (#605)", () => {
  it("is declared on the contract", () => {
    // The pane changes xterm's grid at this offset and nowhere else; without
    // the declaration the read loop cannot see the cut at all.
    expect(contractSource).toMatch(/^\s*gridCursor\?: number;$/m);
  });

  it("is optional, because a daemon predating it still answers", () => {
    expect(contractSource).toMatch(/gridCursor\?/);
    expect(
      resultSchemas["session.start"].safeParse(validSession).success,
    ).toBe(true);
  });

  it("is accepted by the runtime schema the contract describes", () => {
    const parsed = resultSchemas["session.start"].safeParse({
      ...validSession,
      gridCursor: 4096,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as { gridCursor?: number }).gridCursor).toBe(4096);
    }
  });
});

describe("ReadResult gridChanges (#605)", () => {
  it("is declared on the contract", () => {
    // Finding F1: without it the renderer sees only the newest cut and
    // parses the bytes composed at an intermediate grid at the wrong width.
    expect(contractSource).toMatch(
      /^\s*gridChanges\?: \{ cursor: number; cols: number; rows: number \}\[\];$/m,
    );
  });

  it("is optional, matching the runtime schema", () => {
    expect(contractSource).toMatch(/gridChanges\?/);
    const parsed = resultSchemas["session.read"].safeParse({
      session: validSession,
      dataBase64: "",
      startCursor: 0,
      nextCursor: 0,
      truncated: false,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("Session observed-harness fields (#622)", () => {
  it("are declared on the contract", () => {
    // The overlay reads the daemon's foreground-process observation off
    // these fields; without the declarations the row cannot name what it
    // is actually running.
    expect(contractSource).toMatch(
      /^\s*observedHarnessId\?: HarnessId \| null;$/m,
    );
    expect(contractSource).toMatch(
      /^\s*observedHarnessAt\?: string \| null;$/m,
    );
  });

  it("are optional, because a daemon predating them still answers", () => {
    expect(contractSource).toMatch(/observedHarnessId\?/);
    expect(contractSource).toMatch(/observedHarnessAt\?/);
    expect(
      resultSchemas["session.start"].safeParse(validSession).success,
    ).toBe(true);
  });

  it("are accepted by the runtime schema the contract describes", () => {
    const observedHarnessAt = new Date(0).toISOString();
    const parsed = resultSchemas["session.start"].safeParse({
      ...validSession,
      observedHarnessId: "claude",
      observedHarnessAt,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(
        (parsed.data as { observedHarnessId?: string | null })
          .observedHarnessId,
      ).toBe("claude");
      expect(
        (parsed.data as { observedHarnessAt?: string | null })
          .observedHarnessAt,
      ).toBe(observedHarnessAt);
    }
  });
});
