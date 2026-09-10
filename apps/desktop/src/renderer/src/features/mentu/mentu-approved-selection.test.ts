// Selection/binding unit tests for `mentu-approved-selection.ts`: the
// four display verdicts from renderer-held data only, approval binding
// over exact bytes plus selection, invalidation on any drift, and the
// save-conflict shape that preserves the draft.

import { describe, expect, it } from "vitest";
import {
  bindApproval,
  classifySelection,
  conflictMessage,
  detectSaveConflict,
  isBindingValid,
  type ApprovedSelection,
} from "./mentu-approved-selection";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const selection: ApprovedSelection = {
  backend: "codex",
  model: "gpt-5.6-luna",
  catalogFreshness: null,
};

describe("classifySelection", () => {
  it("reports unavailable before anything else", () => {
    expect(
      classifySelection({
        runtimeAvailable: false,
        loadedHash: HASH_A,
        currentHash: HASH_B,
        daemonRefusal: "no adapter",
      }),
    ).toMatchObject({ kind: "unavailable" });
  });

  it("surfaces the daemon refusal as unsupported", () => {
    const verdict = classifySelection({
      runtimeAvailable: true,
      loadedHash: HASH_A,
      currentHash: HASH_A,
      daemonRefusal: "Step 'a' selects backend 'opencode', which mentu-recipes 0.5.0 cannot execute",
    });
    expect(verdict.kind).toBe("unsupported");
    expect(verdict.reason).toContain("opencode");
  });

  it("marks changed bytes stale", () => {
    expect(
      classifySelection({
        runtimeAvailable: true,
        loadedHash: HASH_A,
        currentHash: HASH_B,
      }).kind,
    ).toBe("stale");
  });

  it("defaults honest manual entries to unverified, never confirmed", () => {
    const verdict = classifySelection({
      runtimeAvailable: true,
      loadedHash: HASH_A,
      currentHash: HASH_A,
    });
    expect(verdict.kind).toBe("unverified");
    expect(verdict.reason).toContain("unverified");
  });
});

describe("approval binding", () => {
  it("binds bytes plus selection, and invalidates on any drift", () => {
    const bound = bindApproval({
      contentHash: HASH_A,
      selection,
      adapterContext: "codex adapter",
    });
    expect("error" in bound).toBe(false);
    if ("error" in bound) return;
    expect(isBindingValid(bound, HASH_A, selection)).toBe(true);
    expect(isBindingValid(bound, HASH_B, selection)).toBe(false);
    expect(
      isBindingValid(bound, HASH_A, { ...selection, model: "other" }),
    ).toBe(false);
    expect(
      isBindingValid(bound, HASH_A, { ...selection, backend: "claude" }),
    ).toBe(false);
  });

  it("refuses to bind without a hash or backend", () => {
    expect(
      "error" in bindApproval({ contentHash: "zz", selection, adapterContext: "" }),
    ).toBe(true);
    expect(
      "error" in
        bindApproval({
          contentHash: HASH_A,
          selection: { ...selection, backend: "" },
          adapterContext: "",
        }),
    ).toBe(true);
  });
});

describe("save conflict", () => {
  it("detects a stale base and keeps both hashes for reload/review", () => {
    expect(detectSaveConflict(HASH_A, HASH_A)).toBeNull();
    const conflict = detectSaveConflict(HASH_A, HASH_B);
    expect(conflict).toEqual({ expectedHash: HASH_A, currentHash: HASH_B });
    expect(conflictMessage(conflict!)).toContain(HASH_B.slice(0, 12));
    expect(conflictMessage(conflict!)).toContain("preserved");
  });
});
