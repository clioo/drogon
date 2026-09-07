import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// WP-CAP-DEVICE pending register. This file RUNS; its real assertions pin the
// frozen-port provenance hashes, and every historically-pending voice/speech,
// emulator and computer-use item is declared as an explicit `it.todo` —
// vitest reports todo separately from pass, so a pending obligation can never
// be counted as satisfied by this package. Provenance:
// docs/migration/five-vertical-handoff.md §6 V4 gate ("sin inventar botones de
// grabación o adaptadores que eran pendientes del origen", "No acceder a
// micrófonos/grabaciones/cuentas reales", "Timeout de speech no demuestra
// exit físico"), docs/migration/parity-speech-catalog.md (unverified local
// download contents, API-key-presence cloud readiness), and §5 E5 obligations
// AO-RECORDINGS / AO-SERVICE.

const FROZEN_PORTS = [
  {
    id: "computer-verification",
    file: "../computer-verification/src/main/computer/computer-action-verification-normalization.test.ts",
    sha256: "a6d534d37151777d419505f724a0fb3ad6d6d6ccccd3ce036759d8a913af1d37",
    cases: 1,
  },
  {
    id: "android-input",
    file: "../android-input/src/main/emulator/android/android-input-mapping.test.ts",
    sha256: "ca913619e2f37e15689a8d72ead03a5b1366fe65d788937f65d815ee938dd7ea",
    cases: 8,
  },
  {
    id: "audio-chunker",
    file: "../audio-chunker/src/main/speech/stt-offline-audio-chunker.test.ts",
    sha256: "c0eda15494dba60a2126ab50b50f5ee7853d8ad787b2e526ad501f8d9d61de42",
    cases: 7,
  },
  {
    id: "speech-deletion",
    file: "../speech-deletion/src/main/speech/speech-model-deletion.test.ts",
    sha256: "f836e6983413dda6078692e7acd95548c5bae57bee4f770aac906d8569039c72",
    cases: 4,
  },
  {
    id: "model-config",
    file: "../model-config/src/main/speech/stt-worker-model-config.test.ts",
    sha256: "6861529a69451e9394958077942e4ae5106723f54260d9406b97d28d75672cfc",
    cases: 5,
  },
];

describe("WP-CAP-DEVICE frozen-port provenance self-check", () => {
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

describe("WP-CAP-DEVICE historically-pending obligations (pending-not-implemented)", () => {
  // No microphone was accessed and no recording was captured or read; a real
  // capture/lifecycle journey is a distinct obligation from offline chunking math.
  it.todo(
    "real microphone capture and recording lifecycle (no mic/recording was accessed here)",
  );

  // A speech/stt timeout or lost contact is `unverifiable`, never proof of a
  // physical exit; live/unverifiable/exited verdicts need a real observation.
  it.todo("physical-exit proof for speech worker sessions (timeout is not exit)");

  // parity-speech-catalog.md: ten local models declare 35 download files with
  // source hashes/sizes; contents were never downloaded or byte-verified, and
  // cloud-provider readiness by API-key presence is not a connectivity or
  // transcription-accuracy claim.
  it.todo(
    "verified local speech model downloads and real cloud transcription readiness",
  );

  // android-input-mapping pins pure coordinate/keycode math; no adb/scrcpy
  // device, emulator process or real Android/iOS session was launched or driven.
  it.todo(
    "real Android/iOS emulator device journeys beyond pure input-mapping math",
  );

  // computer-action-verification-normalization pins a pure post-state
  // normalization function; no accessibility tree, screenshot capture or
  // macOS computer-use permission prompt was exercised against a live session.
  it.todo(
    "real computer-use accessibility/screenshot journeys and macOS permission-prompt flow",
  );

  // BM-style IPC acceptance for the speech/emulator/computer-use callbacks
  // (not merely the pure functions they wrap) remains open.
  it.todo(
    "registered-IPC boundary acceptance for speech/emulator/computer-use callbacks",
  );
});
