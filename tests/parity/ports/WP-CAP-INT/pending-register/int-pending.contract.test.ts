import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// WP-CAP-INT pending register. This file RUNS; its real assertions pin the
// frozen-port provenance hashes, and every historically-pending
// provider-integration item is declared as an explicit `it.todo` — vitest
// reports todo separately from pass, so a pending obligation can never be
// counted as satisfied by this package. Provenance:
// docs/migration/e3-integrations-root-review.md,
// docs/migration/e3-integrations-correction-root-review.md ("real
// native/provider/SSH/folder/skew obligations", E5 rights/notices/recordings/
// service decisions), and docs/migration/five-vertical-handoff.md §6 V4 gate.

const FROZEN_PORTS = [
  {
    id: "jira-mutations",
    file: "../jira-mutations/src/main/jira/jira-issue-mutations.test.ts",
    sha256: "818d5a1f26a14d5123303cc688ccad3762a56c0770c96de39d6dc5bd90c7ecca",
    cases: 6,
  },
  {
    id: "linear-teams",
    file: "../linear-teams/src/main/linear/teams.test.ts",
    sha256: "cd5528c5f72ee4d20573618d9f275c969ed2f9fa75469fbe0942b7f2f34be54f",
    cases: 8,
  },
  {
    id: "github-auto-merge",
    file: "../github-auto-merge/src/shared/github/pull-request-auto-merge-availability.test.ts",
    sha256: "c1748277f90cc9129064df583a1f0e0e194e48e9d5f8116049da8847f5815c3c",
    cases: 5,
  },
  {
    id: "gitlab-mr-rate-limit",
    file: "../gitlab-mr-rate-limit/src/main/gitlab/client-mr-auth-rate-limit.test.ts",
    sha256: "809df2df8e5a0d0621a1216005ad15993d252d1018cbbbbf764fa4232278b343",
    cases: 5,
  },
  {
    id: "bitbucket-status",
    file: "../bitbucket-status/src/main/bitbucket/status-no-decrypt.test.ts",
    sha256: "63937e170d202c5091c8a2d8391347ce72ea313efa6635a1130f1c519d0a8755",
    cases: 3,
  },
  {
    id: "github-identity-key",
    file: "../github-identity-key/src/shared/github/repository-identity-key.test.ts",
    sha256: "2a50bd0267389c62476ef85a52bd6a394dcc89ec7b2c8d2a21bbfe46dc66594b",
    cases: 1,
  },
];

describe("WP-CAP-INT frozen-port provenance self-check", () => {
  it.each(FROZEN_PORTS)(
    "$id stays byte-identical to the pinned source blob",
    (port) => {
      const bytes = readFileSync(path.resolve(import.meta.dirname, port.file));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        port.sha256,
      );
      expect(bytes.toString("utf8").match(/\bit\(|\bit\.each\(/g)?.length).toBe(
        port.cases,
      );
    },
  );
});

describe("WP-CAP-INT historically-pending obligations (pending-not-implemented)", () => {
  // The frozen suites pin pure request-shaping/normalization/rate-limit-cache
  // logic against mocked clients; no real Jira/Linear/GitHub/GitLab/Bitbucket/
  // Gitea/Azure DevOps CRUD, auth or webhook journey was exercised.
  it.todo(
    "real provider CRUD/auth journeys against a live API (creation, mutation, webhook)",
  );

  // e3-integrations-correction-root-review.md: real native/provider/SSH/folder
  // and workspace-skew obligations remain open; no SSH transport or folder
  // identity join was touched here.
  it.todo("real SSH/folder-workspace identity and skew obligations");

  // status-no-decrypt pins the cold/no-decrypt path only; a warm keychain
  // unlock, real OS credential-store prompt and cross-session cache
  // invalidation are separate, unexercised obligations.
  it.todo(
    "real keychain/credential-store unlock and cross-session cache invalidation",
  );

  // client-mr-auth-rate-limit pins the in-memory rate-limit cache and mocked
  // auth-error diagnosis; a live 429/backoff/retry journey against a real
  // provider endpoint was never observed.
  it.todo("real rate-limit/backoff/retry journeys against a live provider endpoint");

  // e3-integrations-correction-root-review.md: E5 rights/notices/recordings/
  // service decisions for integrations are explicitly unresolved boundaries.
  it.todo("E5 rights/notices/recordings/service decisions for integrations");

  // BM-style IPC acceptance for the seven provider families' callbacks
  // (not merely the pure functions/clients they wrap) remains open.
  it.todo("registered-IPC boundary acceptance for provider-integration callbacks");
});
