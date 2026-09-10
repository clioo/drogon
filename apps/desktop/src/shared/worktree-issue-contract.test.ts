import { expect, test } from "vitest";
import { issueDetailsSchema, worktreeIssueLinkSchema } from "./worktree-issue-contract";
const base = { provider: "jira", identifier: "KAN-1", title: "Observed title" };
test("optional metadata defaults preserve an honestly unknown URL and site", () => {
  expect(issueDetailsSchema.parse(base)).toEqual({ ...base, url: null, siteId: null, stateName: null, labels: [] });
});
test.each(["http://127.0.0.1:4317/browse/KAN-1", "https://[::1]/browse/KAN-1", "https://例え.jp/browse/KAN-1"])("accepts a valid Jira URL %s", (url) => {
  expect(issueDetailsSchema.safeParse({ ...base, url }).success).toBe(true);
});
test.each(["javascript:alert(1)", "file:///private/data", "https://:", "https://[invalid]", "https://example.com:99999", "https://user:secret@example.com", "https://example.com\\other", "https://example.com/\u007f"])("rejects invalid URL %s without throwing", (url) => {
  expect(issueDetailsSchema.safeParse({ ...base, url }).success).toBe(false);
});
test("Linear URLs belong to Linear, including normalized default ports", () => {
  const linear = { ...base, provider: "linear" };
  expect(issueDetailsSchema.safeParse({ ...linear, url: "HTTPS://LINEAR.APP:443/team/issue/KAN-1" }).success).toBe(true);
  for (const url of ["https://linear.app.evil.example/issue/KAN-1", "https://linear.app:444/issue/KAN-1"])
    expect(issueDetailsSchema.safeParse({ ...linear, url }).success).toBe(false);
});
test("UTF-8 bounds match the native contract rather than counting UTF-16 units", () => {
  expect(issueDetailsSchema.safeParse({ ...base, title: "🐉".repeat(1024) }).success).toBe(true);
  expect(issueDetailsSchema.safeParse({ ...base, title: "🐉".repeat(1025) }).success).toBe(false);
  expect(issueDetailsSchema.safeParse({ ...base, labels: ["🐉".repeat(33)] }).success).toBe(false);
});
test("writes reject unknown fields while additive read fields remain compatible", () => {
  expect(issueDetailsSchema.safeParse({ ...base, accessToken: "not-a-real-token" }).success).toBe(false);
  const decoded = worktreeIssueLinkSchema.parse({ ...base, worktreeId: "wt", futureDisplayHint: "future" });
  expect(decoded.worktreeId).toBe("wt");
  expect(decoded).not.toHaveProperty("futureDisplayHint");
});
