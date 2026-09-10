// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  buildLinearIssueUrl,
  getLinearOrganizationUrlKeyFromIssueUrl,
  parseLinearIssueInput,
} from "../../../../../shared/worktree-issue-contract";

describe("linear issue input (shared save gate)", () => {
  test("accepts a bare key uppercased with no org key", () => {
    expect(parseLinearIssueInput("eng-123")).toEqual({ identifier: "ENG-123" });
    expect(parseLinearIssueInput("  STA-335  ")?.identifier).toBe("STA-335");
  });

  test("accepts a linear.app URL with its org key", () => {
    expect(
      parseLinearIssueInput("https://linear.app/drogon/issue/ENG-123"),
    ).toEqual({ identifier: "ENG-123", organizationUrlKey: "drogon" });
  });

  test("rejects non-Linear input", () => {
    for (const input of [
      "",
      "123",
      "#42",
      "ENG-",
      "https://example.com/issue/ENG-123",
      "https://linear.app.evil.example/issue/ENG-123",
      "javascript:alert(1)",
      "file:///linear.app/issue/ENG-123",
    ]) {
      expect(parseLinearIssueInput(input)).toBeNull();
    }
  });

  test("builds the canonical URL only with both parts", () => {
    expect(
      buildLinearIssueUrl({ identifier: "ENG-123", organizationUrlKey: "drogon" }),
    ).toBe("https://linear.app/drogon/issue/ENG-123");
    expect(buildLinearIssueUrl({ identifier: "ENG-123" })).toBeNull();
    expect(
      buildLinearIssueUrl({ identifier: "nope", organizationUrlKey: "drogon" }),
    ).toBeNull();
  });

  test("reads the org key off an issue URL", () => {
    expect(
      getLinearOrganizationUrlKeyFromIssueUrl("https://linear.app/drogon/issue/ENG-123"),
    ).toBe("drogon");
    expect(getLinearOrganizationUrlKeyFromIssueUrl(null)).toBeNull();
    expect(
      getLinearOrganizationUrlKeyFromIssueUrl("https://example.com/x"),
    ).toBeNull();
  });
});
