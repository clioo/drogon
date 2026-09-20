// session-contract.ts is a types-only module: at runtime it is erased, so no
// behavioural test can reach it. What can be held is that the contract and
// its runtime twin — the zod schemas in result-validation.ts, which is what
// actually accepts or rejects a daemon payload — agree about the fields the
// renderer depends on. A field declared in one and missing from the other is
// how a payload silently stops reaching the code that needs it.
// Compile-time pin for the additive observed-harness fields of
// `session-contract.ts` (issue #622): esbuild erases types, so no runtime
// test can pin `Session["observedHarnessId"]` / `Session["observedHarnessAt"]`.
// This test spawns the repo's own TypeScript (the same binary
// `pnpm typecheck:renderer-contracts` uses) over a small fixture that reads
// both fields off the real contract and assigns them to their declared
// nullable types. tsc exits 0 today and fails with a property error when
// either field is removed.
import { spawnSync } from "node:child_process";
import fs, { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, test } from "vitest";
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

const testDir = dirname(fileURLToPath(import.meta.url));
const contractPath = join(testDir, "session-contract.ts");
const repoRoot = join(testDir, "..", "..", "..", "..");
const tscBin = join(
  repoRoot,
  "apps",
  "desktop",
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

function fixtureSource(contractSpecifier: string): string {
  return `import type { HarnessId, Session } from ${JSON.stringify(contractSpecifier)};
const observedId: Session["observedHarnessId"] = undefined;
const checkId: HarnessId | null | undefined = observedId;
const observedAt: Session["observedHarnessAt"] = undefined;
const checkAt: string | null | undefined = observedAt;
export { checkAt, checkId };
`;
}

/// Typechecks one fixture file with the repo's own tsc; returns the
/// completed spawn result. The fixture's temp dir is the working directory
/// so tsc never picks up the repo's own tsconfig — the flags above are the
/// whole configuration.
function typecheck(fixtureDir: string, fixturePath: string) {
  return spawnSync(
    process.execPath,
    [
      tscBin,
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "es2022",
      "--module",
      "esnext",
      "--moduleResolution",
      "bundler",
      fixturePath,
    ],
    { cwd: fixtureDir, encoding: "utf8", timeout: 100_000 },
  );
}

describe(
  "session-contract observed-harness fields (issue #622, F8)",
  () => {
    test(
      "the contract still carries both observed fields with their nullable types",
      { timeout: 120_000 },
      () => {
        const dir = mkdtempSync(join(tmpdir(), "session-contract-pin-"));
        try {
          const specifier = relative(dir, contractPath).replace(/\\/g, "/").replace(/\.ts$/, "");
          const fixturePath = join(dir, "pin.ts");
          writeFileSync(fixturePath, fixtureSource(`./${specifier}`));
          const result = typecheck(dir, fixturePath);
          expect(
            `${result.stdout ?? ""}${result.stderr ?? ""}`,
            "repo tsc must accept the observed-harness pin fixture",
          ).toBe("");
          expect(result.status).toBe(0);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    );
  },
);
