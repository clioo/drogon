# Isolated web fallback contract characterization

Executed by the root coordinator on 2026-09-06 using Node 24.19.0, macOS arm64. Result: **4 passed, 0 failed, 0 skipped, 0 cancelled, 0 todo; exit 0**. These are four new diagnostic cases, **not four migrated/original Orca tests**. They characterize existing failure conditions; passing does not mean those defects are fixed or the UI works.

Probe: `scripts/probe-web-fallback-contract.mjs`. The script reads and verifies exact SHA-256 bytes before executing the original `web-fallback-api.ts`, `web-storage.ts` and `mentu-session-request-coalescer.ts` modules. Root separately checked the three digests against the Git blobs at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. No source file is modified. Their existing MIT copyright/license remains in the reference checkout; the probe does not copy their implementation into Drogon.

Reproduce from the rewrite checkout, using the verified Node 24 runtime:

```sh
DROGON_PARITY_SOURCE_ROOT=/Users/carlos/Documents/Drogon-mentu-session \
  /Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --experimental-vm-modules --test scripts/probe-web-fallback-contract.mjs
```

The absolute paths above identify this machine's execution evidence. Other machines must use their own read-only reference checkout with the same verified bytes and a compatible Node runtime. Node emits experimental warnings for type stripping and VM modules; there are no extra installed dependencies. Module linking is allowlisted to the reviewed storage import; unexpected imports fail. The evaluated modules have no top-level browser, filesystem, network or process side effects. Their exported functions run inside a context without a browser/profile or provider credentials; the probe never calls the storage read/write functions. The VM is test isolation, not a security boundary.

## Observed contracts

1. Wrapping an object without Meetings or Mentu creates truthy function proxies for both missing namespaces. Presence checks do not identify them as unavailable.
2. The actual fallback `meetings.list` returns an array. It bypasses a nullish unavailable-snapshot fallback, has no `meetings` member, and the mirrored `snapshot?.meetings.length ?? 0` expression throws.
3. The actual Mentu request coalescer fulfills with `capabilityResult: undefined` and an array catalog. Its rejection handler cannot normalize a fulfilled malformed result. The mirrored `'label' in capabilityResult` expression throws.
4. A fixture with explicitly rejecting capability/catalog calls is a distinct positive control: the actual coalescer returns unavailable capability and null catalog.

## Exact limits and migration consequence

The probe constructs only the missing-namespace slice of the API. It **does not** execute the entire `createWebPreloadApi` composition, React hooks/components, store state, a real remote host, Electron or a browser. The two consumer expressions are explicitly mirrored from reviewed source, not the real rendered components. Source inspection supports the composition concern: the current web composition has no explicit Mentu/Meetings implementation, the Meetings loader uses nullish fallback, and the Mentu loading hook reads `'label' in capabilityResult`. Those source findings still require full composed-web renderer regressions and real UI validation.

This evidence strengthens E1's source-defect candidates without closing E1, changing the approximately60% audit estimate, or proving candidate parity. Preserve unavailable/error UX requirements during the rewrite; do not intentionally reproduce these defects as successful compatibility behavior. Original test obligations remain unchanged.
