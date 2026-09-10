// C06: stable task identity — derivation parity with the daemon
// (crates/drogon-core/src/jira/identity.rs) and the unresolved-legacy rule.
import { describe, expect, it } from "vitest";
import {
  getJiraTaskIdentity,
  jiraInstanceId,
  jiraTaskLinkId,
  normalizeJiraSiteUrl,
  sameJiraTaskIdentity,
} from "./jira-task-identity";

describe("normalizeJiraSiteUrl (fork shape)", () => {
  it("matches the daemon normalizer", () => {
    expect(normalizeJiraSiteUrl("example.atlassian.net")).toBe(
      "https://example.atlassian.net",
    );
    expect(normalizeJiraSiteUrl("https://jira.example.com/jira/?x=1#y")).toBe(
      "https://jira.example.com/jira",
    );
    expect(normalizeJiraSiteUrl("   ")).toBeNull();
    expect(normalizeJiraSiteUrl("https://")).toBeNull();
  });
});

describe("jiraInstanceId", () => {
  it("is account-independent and case-folded like the daemon", async () => {
    expect(await jiraInstanceId("https://acme.atlassian.net")).toBe(
      await jiraInstanceId("https://ACME.atlassian.net/"),
    );
    expect(await jiraInstanceId("https://acme.atlassian.net")).toHaveLength(24);
    expect(await jiraInstanceId("https://globex.atlassian.net")).not.toBe(
      await jiraInstanceId("https://acme.atlassian.net"),
    );
  });

  it("is null for unresolvable input", async () => {
    expect(await jiraInstanceId("")).toBeNull();
    expect(await jiraInstanceId("https://")).toBeNull();
  });
});

describe("getJiraTaskIdentity", () => {
  it("resolves from the immutable id + instance URL", async () => {
    const identity = await getJiraTaskIdentity(
      { issueId: "10001", key: "DROG-42" },
      "https://acme.atlassian.net",
    );
    expect(identity).toEqual({
      provider: "jira",
      instanceId: await jiraInstanceId("https://acme.atlassian.net"),
      instanceUrl: "https://acme.atlassian.net",
      issueId: "10001",
      key: "DROG-42",
    });
    expect(jiraTaskLinkId(identity!)).toBe(
      `${identity!.instanceId}:10001`,
    );
  });

  it("stays unresolved without an instance URL or immutable id", async () => {
    expect(
      await getJiraTaskIdentity({ issueId: "10001", key: "DROG-42" }, null),
    ).toBeNull();
    expect(
      await getJiraTaskIdentity({ issueId: "", key: "DROG-42" }, "https://acme.atlassian.net"),
    ).toBeNull();
    // The legacy per-account site id is never an identity input.
    expect(
      await getJiraTaskIdentity(
        // `siteId` is extra data a legacy issue row carries; it must be
        // ignored (the type accepts only the immutable id + display key).
        { issueId: "", key: "DROG-42", ...( { siteId: "legacysiteid123" } as object) },
        "https://acme.atlassian.net",
      ),
    ).toBeNull();
  });

  it("compares by instance+issue id, not the display key", async () => {
    const a = await getJiraTaskIdentity(
      { issueId: "10001", key: "DROG-42" },
      "https://acme.atlassian.net",
    );
    const renamed = await getJiraTaskIdentity(
      { issueId: "10001", key: "OPS-9" },
      "https://acme.atlassian.net",
    );
    const other = await getJiraTaskIdentity(
      { issueId: "10002", key: "DROG-42" },
      "https://acme.atlassian.net",
    );
    expect(sameJiraTaskIdentity(a!, renamed!)).toBe(true);
    expect(sameJiraTaskIdentity(a!, other!)).toBe(false);
  });
});
