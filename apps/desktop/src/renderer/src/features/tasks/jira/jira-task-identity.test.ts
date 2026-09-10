// C06: stable task identity — two-tier derivation parity with the daemon
// (crates/drogon-core/src/jira/identity.rs) and the unresolved-legacy rule.
import { describe, expect, it } from "vitest";
import {
  cloudTenantIdFromAccessibleResources,
  isImmutableInstanceIdentity,
  jiraInstanceKey,
  jiraTaskLinkId,
  normalizeJiraSiteUrl,
  provisionalEndpointId,
  resolveEndpointAttestedJiraTaskIdentity,
  resolveProvisionalJiraTaskIdentity,
  resolveSourceBackedJiraTaskIdentity,
  sameJiraTaskIdentity,
  serverAttestedBaseUrlFromServerInfo,
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

describe("provisionalEndpointId (configured-endpoint label)", () => {
  it("is account-independent and case-folded like the daemon", async () => {
    expect(await provisionalEndpointId("https://acme.atlassian.net")).toBe(
      await provisionalEndpointId("https://ACME.atlassian.net/"),
    );
    expect(await provisionalEndpointId("https://acme.atlassian.net")).toHaveLength(24);
    expect(await provisionalEndpointId("https://globex.atlassian.net")).not.toBe(
      await provisionalEndpointId("https://acme.atlassian.net"),
    );
  });

  it("is null for unresolvable input", async () => {
    expect(await provisionalEndpointId("")).toBeNull();
    expect(await provisionalEndpointId("https://")).toBeNull();
  });
});

describe("resolveProvisionalJiraTaskIdentity", () => {
  it("resolves EXPLICITLY at the provisional tier", async () => {
    const identity = await resolveProvisionalJiraTaskIdentity(
      { issueId: "10001", key: "DROG-42" },
      "https://acme.atlassian.net",
    );
    expect(identity?.instance.kind).toBe("provisional");
    expect(identity?.instance.endpointUrl).toBe("https://acme.atlassian.net");
    const endpointId =
      identity?.instance.kind === "provisional" ? identity.instance.endpointId : null;
    expect(jiraInstanceKey(identity!.instance)).toBe(`provisional:${endpointId}`);
    expect(jiraTaskLinkId(identity!)).toBe(`${jiraInstanceKey(identity!.instance)}:10001`);
  });

  it("stays unresolved without an endpoint URL or immutable id", async () => {
    expect(
      await resolveProvisionalJiraTaskIdentity(
        { issueId: "10001", key: "DROG-42" },
        null,
      ),
    ).toBeNull();
    expect(
      await resolveProvisionalJiraTaskIdentity(
        { issueId: "", key: "DROG-42" },
        "https://acme.atlassian.net",
      ),
    ).toBeNull();
  });

  it("compares by endpoint+issue id, not the display key", async () => {
    const a = await resolveProvisionalJiraTaskIdentity(
      { issueId: "10001", key: "DROG-42" },
      "https://acme.atlassian.net",
    );
    const renamed = await resolveProvisionalJiraTaskIdentity(
      { issueId: "10001", key: "OPS-9" },
      "https://acme.atlassian.net",
    );
    const other = await resolveProvisionalJiraTaskIdentity(
      { issueId: "10002", key: "DROG-42" },
      "https://acme.atlassian.net",
    );
    expect(sameJiraTaskIdentity(a!, renamed!)).toBe(true);
    expect(sameJiraTaskIdentity(a!, other!)).toBe(false);
  });
});

describe("resolveSourceBackedJiraTaskIdentity (identity of record)", () => {
  it("lives in a different namespace than the provisional tier", async () => {
    const verified = resolveSourceBackedJiraTaskIdentity(
      "cloud-tenant-id",
      "Aa1Bb2Cc3",
      "https://acme.atlassian.net",
      "2026-01-01T00:00:00Z",
      { issueId: "10001", key: "DROG-42" },
    );
    expect(verified?.instance.kind).toBe("source-backed");
    expect(jiraInstanceKey(verified!.instance)).toBe("cloudid:Aa1Bb2Cc3");
    // A configured URL alone NEVER produces the verified tier's key.
    const provisional = await resolveProvisionalJiraTaskIdentity(
      { issueId: "10001", key: "DROG-42" },
      "https://acme.atlassian.net",
    );
    expect(jiraInstanceKey(provisional!.instance)).not.toEqual(
      jiraInstanceKey(verified!.instance),
    );
    expect(sameJiraTaskIdentity(provisional!, verified!)).toBe(false);
  });

  it("rejects empty identifiers", () => {
    expect(
      resolveSourceBackedJiraTaskIdentity(
        "cloud-tenant-id",
        "  ",
        "https://acme.atlassian.net",
        "t",
        { issueId: "10001", key: "DROG-42" },
      ),
    ).toBeNull();
  });
});

describe("deterministic producers (pure payload parsing)", () => {
  it("cloudTenantIdFromAccessibleResources matches the configured endpoint", () => {
    const payload = [
      { id: "Aa1Bb2Cc3", url: "https://acme.atlassian.net", name: "acme" },
      { id: "Other1", url: "https://other.atlassian.net", name: "other" },
    ];
    expect(cloudTenantIdFromAccessibleResources(payload, "https://acme.atlassian.net")).toBe(
      "Aa1Bb2Cc3",
    );
    expect(cloudTenantIdFromAccessibleResources(payload, "https://ACME.atlassian.net/")).toBe(
      "Aa1Bb2Cc3",
    );
    expect(
      cloudTenantIdFromAccessibleResources(payload, "https://zeta.atlassian.net"),
    ).toBeNull();
  });

  it("serverAttestedBaseUrlFromServerInfo yields ENDPOINT attestation only", () => {
    expect(
      serverAttestedBaseUrlFromServerInfo({
        baseUrl: "https://jira.internal.example.com/",
        version: "9.4.0",
      }),
    ).toBe("https://jira.internal.example.com");
    expect(serverAttestedBaseUrlFromServerInfo({})).toBeNull();
    // The attested URL is a third tier: source-observed but explicitly
    // unresolved for immutable-instance continuity (a moved endpoint can
    // keep the same installation).
    const identity = resolveEndpointAttestedJiraTaskIdentity(
      "https://jira.internal.example.com",
      "2026-01-01T00:00:00Z",
      { issueId: "10001", key: "DROG-42" },
    );
    expect(identity?.instance.kind).toBe("endpoint-attested");
    expect(jiraInstanceKey(identity!.instance)).toBe(
      "attested:https://jira.internal.example.com",
    );
    expect(isImmutableInstanceIdentity(identity!.instance)).toBe(false);
  });

  it("cloudTenantId remains the only immutable-instance evidence tier", () => {
    const verified = resolveSourceBackedJiraTaskIdentity(
      "cloud-tenant-id",
      "Aa1Bb2Cc3",
      "https://acme.atlassian.net",
      "2026-01-01T00:00:00Z",
      { issueId: "10001", key: "DROG-42" },
    );
    expect(isImmutableInstanceIdentity(verified!.instance)).toBe(true);
  });
});
