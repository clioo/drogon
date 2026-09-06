// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3, src/shared/execution-host.ts
// (SHA256 b50beb1c179026e1457e490455fdcad1ebfa500b714635b598aa52dd6e55247a),
// declarations: LOCAL_EXECUTION_HOST_ID, ExecutionHostId, ExecutionHostKind.
// Type-only extraction; the runtime host parsers/normalizers stay in the
// pinned source and remain a root integration gate.

export const LOCAL_EXECUTION_HOST_ID = 'local'

export type ExecutionHostKind = 'local' | 'ssh' | 'runtime'
export type ExecutionHostId = typeof LOCAL_EXECUTION_HOST_ID | `ssh:${string}` | `runtime:${string}`
