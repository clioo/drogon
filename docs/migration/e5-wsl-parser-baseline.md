# E5 WSL output parser: unchanged source baseline

2026-09-06. Root read the complete original `src/main/wsl-distro-list-output.ts` and its complete two-case test before executing. Production and assertion bytes were copied unchanged from pinned revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, with the original MIT license and Lovecast notice, using the existing baseline capsule runner. No dependency installation or reference-checkout write occurred.

**Result:2/2 passed**, no failed/pending/todo cases, process exit0, no timeout. Runtime: Vitest4.1.11, Node24.19.0, darwin-arm64. Root opened the retained results and stage receipt independently, verified unchanged staged bytes and checked the two assertion outcomes:

- NUL-padded output/default-distro marker normalizes to `Ubuntu`.
- Docker-managed distributions are excluded from the returned user list.

Manifest: `tests/parity/baseline-capsules/wsl-distro-list-output.json`, SHA256 `79a735d6e7fb1d14423b5c655d019cc15f0004a40eb3ff455db4f4e6b1c3d567`.

Retained local capsule: `.preflight/parity-baseline/audit-e5-wsl-output-jkfKSc/`. Results file `vitest-results.json` SHA256 `06bb093c7cdb7af2d945e94732abfe310795e0fc7b83b80a3db614c2478eb049`; `stage-receipt.json` SHA256 `66d839b36f99be27da8163d65c3e5e06e5551a8ae7b3d29490cfc5cebd40e1d6`.

The capsule uses only the exact two source files plus Vitest, omitting unrelated original renderer/port setup, aliases and runtime flags as recorded in the manifest. It neither spawns WSL nor proves real Windows enumeration, cache/backoff, native transport, SSH/liveness, candidate behavioral RED/GREEN or product parity. Original single-flight/running-distro and full-suite obligations remain separate. Audit remains9/12 (~75%, medium-low); isolated cases do not close E5.
