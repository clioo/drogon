import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// WP-CAP-MEET pending register. This file RUNS; its real assertions pin the
// frozen-port provenance hashes, and every historically-pending Meetings/
// speech item is declared as an explicit `it.todo` — vitest reports todo
// separately from pass, so a pending obligation can never be counted as
// satisfied by this package. Provenance: docs/migration/five-vertical-handoff.md
// §6 V4 gate ("sin inventar botones de grabación", "Timeout de speech no
// demuestra exit físico", "No acceder a micrófonos/grabaciones/cuentas reales"),
// docs/migration/parity-speech-catalog.md, and §5 E5 obligations
// AO-RECORDINGS / AO-SERVICE.

const FROZEN_PORTS = [
  {
    id: "page-runtime",
    file: "../page-runtime/src/renderer/src/components/meetings/meetings-page-runtime.test.ts",
    sha256: "8216a4fe327ae82e2afeb68af7a735735fed4e5c27c4a643bc40f9bd3a380502",
    cases: 2,
  },
  {
    id: "speech-catalog",
    file: "../speech-catalog/src/main/speech/model-catalog.test.ts",
    sha256: "6ce0ba6bfbb8d41b18b3678c5a6f7aa6aecb9134fa047b6add5a02751edeac2f",
    cases: 5,
  },
  {
    id: "catalogs-accounts-search",
    file: "../catalogs/src/renderer/src/components/settings/accounts-search.test.ts",
    sha256: "9cee20c8fa73c97fec3ff858f4c2997143788390fd88c6a3c60d551e4c7f3e29",
    cases: 3,
  },
  {
    id: "catalogs-provider-account-scope",
    file: "../catalogs/src/renderer/src/components/settings/provider-account-scope.test.ts",
    sha256: "eb77435a3f5788d959ae8ab5bc7750caa4710aa67f59e468ae5a64f9e476d0bc",
    cases: 5,
  },
];

describe("WP-CAP-MEET frozen-port provenance self-check", () => {
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

describe("WP-CAP-MEET historically-pending obligations (pending-not-implemented)", () => {
  // The origin never shipped working meeting recording controls; the rewrite
  // must not invent them to look complete.
  it.todo(
    "real meeting recording buttons (historically pending in the source)",
  );

  // A speech/stt timeout or lost contact is `unverifiable`, never proof of a
  // physical exit; live/unverifiable/exited verdicts need a real observation.
  it.todo("physical-exit proof for speech sessions (timeout is not exit)");

  // E5 AO-RECORDINGS: transcript/recording provenance, consent and privacy
  // decisions are open; no real recordings were read or written here.
  it.todo("recording provenance and consent decisions (E5 AO-RECORDINGS)");

  // Speech catalog rows are source literals; downloads were never fetched or
  // byte-verified, and cloud readiness by API-key presence is not a
  // connectivity or accuracy claim.
  it.todo("verified speech model downloads and cloud transcription readiness");

  // write-that-down availability signals (installation/connection state) are
  // not authentication or end-to-end meetings availability proof.
  it.todo("end-to-end meetings availability against a real environment");

  // Q&A must go through Drogon after mounting (pinned by the frozen port);
  // any companion-provider Q&A path remains unimplemented and unauthorized.
  it.todo("meetings Q&A beyond the pinned through-Drogon launch path");

  // BM-style IPC acceptance for the speech/meetings callbacks remains open.
  it.todo("registered-IPC boundary acceptance for meetings/speech callbacks");
});
