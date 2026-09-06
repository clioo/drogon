# WSL discovery: unchanged original baselines

2026-09-06. **17/17 cases passed** across two complete original suites: distro-list single-flight (9) and running-distro discovery (8). No failed, pending or todo cases; both processes exited 0 without timeout. Root read the complete production/test dependency closure before execution and independently checked retained results, stage receipts and unchanged staged bytes afterward. Machine-readable fingerprints and exact assertion outcomes are in `e5-wsl-discovery-baselines.json`.

Source revision: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Original production files, tests and MIT/Lovecast notices were retained unchanged. Execution used the existing isolated capsule runner with Vitest 4.1.11 / Node 24.19.0 on darwin-arm64. Manifests: `tests/parity/baseline-capsules/wsl-distro-list-single-flight.json` and `wsl-running-distros.json`. No dependency install or reference-checkout edit occurred.

The suites characterize concurrent probe coalescing, bounded negative retries, newer synchronous results winning over older asynchronous results, cache-reset retirement, running-only discovery, HOME probe coalescing, stopped-distro path filtering and non-Windows no-probe behavior. Original child-process mocks and fake timers remain intact; no actual WSL process was launched.

The virtual 30-minute outage case retains the last-known running distro and asserts fewer than 15 mock spawns. This is neither real host availability nor measured production latency/resource consumption. The legacy boolean fallback does **not** authorize reporting a disconnected execution host as live: rewrite verdicts must remain `live` / `unverifiable` / `exited`, with loss of contact classified as unverifiable.

Original unrelated renderer/port setup, aliases and runtime flags were omitted as explicitly recorded in each manifest. These are source characterization baselines, not native Windows tests, candidate behavioral RED/GREEN, Electron validation or full parity. Audit remains **9/12 (75%, medium-low confidence), delta 0**. E1/E3/E5 source gates remain open; the implementation phase still requires actual Sol leads after full audit acceptance.
