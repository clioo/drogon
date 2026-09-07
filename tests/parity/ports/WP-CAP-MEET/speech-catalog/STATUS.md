# WP-CAP-MEET / speech-catalog — status

- Original: `src/main/speech/model-catalog.test.ts`
  (sha256 `6ce0ba6bfbb8d41b18b3678c5a6f7aa6aecb9134fa047b6add5a02751edeac2f`,
  pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
- Port: byte-identical copy at `src/main/speech/model-catalog.test.ts` here;
  hash verified against the pinned blob at record time and re-verified by the
  pending-register self-check. 5 cases, original relative imports preserved.
- Provenance context: `docs/migration/parity-speech-catalog.md` records the
  12-model G15 registry (10 local, 2 cloud, 5 streaming, 1 recommended) with
  pinned download revisions/hashes. These five source tests pin the Japanese
  Parakeet manifest, catalog-wide unique IDs, SenseVoice classification/layout,
  and its pinned download file set. None was executed against a model; no
  download, mic, recording or cloud call was made.
- Binding: **blocked** — `apps/desktop/src/main/speech/model-catalog` does not
  exist in the rewrite.
- Attempted run (repo runner, this worktree):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-MEET/speech-catalog src/main/speech/model-catalog.test.ts
  ```

  Result: **FAIL at collection, 0 tests run** — cannot resolve
  `./model-catalog`. **Test preparation (blocked binding), not behavioral RED /
  skip / pass.**

- Ownership note: the speech catalog's implementation owner is WP-CAP-DEVICE
  per `docs/migration/parity-speech-catalog.md`; this port records and
  preserves the assertions without claiming that ownership.
