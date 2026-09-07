import { describe, expect, test } from "vitest";
import { annotateOmittedHostScope } from "./remote-listing";

interface Row {
  id: string;
  label: string;
}

const row = (id: string): Row => ({ id, label: `row ${id}` });

describe("annotateOmittedHostScope", () => {
  test("a listing that names its omitted hosts is unverifiable even when rows are empty", () => {
    const listing = annotateOmittedHostScope<Row>({
      rows: [],
      coveredHostIds: ["local"],
      omittedHostIds: ["ssh:bastro", "wsl:ubuntu"],
    });
    // Empty is not evidence that nothing is running elsewhere: the scope
    // is named so the answer stays about selectability, never liveness.
    expect(listing.scope).toBe("unverifiable");
    expect(listing.omittedHostIds).toEqual(["ssh:bastro", "wsl:ubuntu"]);
    expect(listing.rows).toEqual([]);
  });

  test("a listing with nothing omitted is a no-op stamped complete", () => {
    const listing = annotateOmittedHostScope<Row>({
      rows: [row("w1")],
      coveredHostIds: ["local", "ssh:bastro"],
    });
    expect(listing.scope).toBe("complete");
    expect(listing.omittedHostIds).toEqual([]);
    expect(listing.rows).toEqual([row("w1")]);
  });

  test("omitting any host taints the whole listing, not just the omitted rows", () => {
    const listing = annotateOmittedHostScope<Row>({
      rows: [row("w1"), row("w2")],
      coveredHostIds: ["local"],
      omittedHostIds: ["runtime:env-9"],
    });
    expect(listing.scope).toBe("unverifiable");
    expect(listing.rows).toHaveLength(2);
  });
});
