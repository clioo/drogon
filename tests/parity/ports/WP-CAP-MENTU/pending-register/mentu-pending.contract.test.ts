import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// WP-CAP-MENTU pending register. This file RUNS; its real assertions pin the
// frozen-port provenance hashes, and every historically-pending Mentu item is
// declared as an explicit `it.todo` — vitest reports todo separately from
// pass, so a pending obligation can never be counted as satisfied by this
// package. Provenance: docs/migration/five-vertical-handoff.md §6 V4 gate
// ("reactive responsibilities, authoring/inspection of triggers, flush
// barriers, delegation UI, proactive responsibilities, recipe-81/90 and
// shared-spaces: lo pendiente se conserva como pendiente"), §2 ("un registro
// almacenado no demuestra scheduler, ejecución, adaptador reactivo o UI
// funcional"), and docs/migration/audit-closure/e3-bridge/followup-bots-mentu.md
// findings D5–D10 / exact remaining acceptance BM-AUTH…BM-EVIDENCE.

const FROZEN_PORTS = [
  {
    id: "recipe-contract",
    file: "../recipe-contract/src/shared/mentu-recipe-contract.test.ts",
    sha256: "d5dc7fd5999e487c0f54e5d27a79f1fbd4e2fffe2a3c2a6ee09ae4edcb5a0418",
    cases: 7,
  },
  {
    id: "runtime-suite",
    file: "../runtime-suite/src/main/mentu/mentu-runtime.test.ts",
    sha256: "32ad8767932ec2d609190543273b03dd069a9980b93782ad0285c61202231604",
    cases: 12,
  },
  {
    id: "session-execution-suite",
    file: "../session-execution-suite/src/main/mentu/mentu-session-execution.test.ts",
    sha256: "c1ba4423275ca6f4293ede33217919c94a73de4f63b090a2bed46a68f000f80e",
    cases: 13,
  },
  {
    id: "catalogs-skill-sharing",
    file: "../catalogs/src/shared/agent-skill-sharing-contract.test.ts",
    sha256: "6755dc9e58eb62727b93f7c710fd4b416bcc665fc5aad7524c17fc50b79d84ef",
    cases: 2,
  },
];

describe("WP-CAP-MENTU frozen-port provenance self-check", () => {
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

describe("WP-CAP-MENTU historically-pending obligations (pending-not-implemented)", () => {
  // Reactive responsibilities: storing configuration is all the source does;
  // no connected deterministic event adapter exists, and the manual
  // scheduled-run action must keep refusing reactive work (B-reactive).
  it.todo(
    "reactive responsibility execution via a connected deterministic event adapter",
  );

  // Proactive responsibilities/timers are deterministic storage + a future
  // execution gate; the agent's judgment after wakeup is not implemented here.
  it.todo("proactive responsibility timers and wakeup execution gate");

  // Historically pending recipe capabilities named by the V4 gate card.
  it.todo("recipe-81 and recipe-90 capabilities");
  it.todo("shared-spaces capabilities");

  // Commitment Protocol overreach: local run.json/events/state are raw host
  // records only; relabeling them as formal Commitment Protocol records is
  // forbidden (R-status pins the distinction; the guard obligation stays open).
  it.todo(
    "formal Commitment Protocol records (never inferred from run records)",
  );

  // D7: hostObservation is synthesized from the stored status
  // (running→live, terminal→exited); real restart/contact-loss liveness stays
  // `unverifiable` until a real process observation exists.
  it.todo("real process liveness observation for stored running records");

  // D10/LAUNCH: admitted execution only supports the local darwin-arm64
  // pinned identity; remote/WSL/Windows admitted execution is an explicit gap.
  it.todo("admitted Mentu execution beyond local darwin-arm64 pinned identity");

  // D6: recoveryEvidenceDigest omits outcomes/attempts/vars/events/state;
  // full recovery-evidence ownership is unproved.
  it.todo("complete recovery-evidence binding (currently partial digest)");

  // D9/LAUNCH: loose busy-text precedence, cancellation admission and
  // prelaunch TOCTOU races are unproven; no native admission claim.
  it.todo("race-free launch admission (busy-text precedence / TOCTOU closure)");

  // SAVE: guarded hardlink publication is not transactional CAS and has no
  // fsync durability guarantee; the durability decision is open.
  it.todo("durable guarded recipe save (fsync/transaction decision)");

  // BM-AUTH…BM-EVIDENCE remain open; a ported assertion is not their closure.
  it.todo("registered-IPC boundary acceptance for all 14 Mentu callbacks");
});
