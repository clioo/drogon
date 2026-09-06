// Deterministic reference vectors for the native claim-identity port.
//
// This generator replicates the exact canonicalization and signing math of the
// pinned Orca source (Lovecast Inc., MIT, revision
// c97906287bb7a390b25e2025b600d9fb3c25d9c3):
//   src/main/runtime/agent-session-claim-identity.ts
//     - encodeFields: u32 big-endian UTF-8 length prefix + UTF-8 bytes
//     - identity label  "orca-agent-session-claim-v1"
//     - worktree label  "orca-agent-session-worktree-v1"
//     - HMAC-SHA256, base64url without padding
//     - key id = base64url(sha256(key)) truncated to 22 chars
//
// The keys below are deterministic TEST KEYS (byte patterns 0x00..0x1f and
// 0x20..0x3f), not credentials. Run with the pinned Node 24 runtime:
//   node generate-vectors.mjs
// Output: vectors.json (committed next to this file).

import { createHash, createHmac } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const SOURCE_REVISION = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
const IDENTITY_LABEL = 'orca-agent-session-claim-v1'
const WORKTREE_LABEL = 'orca-agent-session-worktree-v1'
const KEY_A = Buffer.from(Array.from({ length: 32 }, (_, i) => i))
const KEY_B = Buffer.from(Array.from({ length: 32 }, (_, i) => 0x20 + i))

function encodeFields(fields) {
  const chunks = []
  for (const field of fields) {
    const value = Buffer.from(field, 'utf8')
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32BE(value.length)
    chunks.push(length, value)
  }
  return Buffer.concat(chunks)
}

function keyId(key) {
  return createHash('sha256').update(key).digest('base64url').slice(0, 22)
}

function hmacFields(key, fields) {
  return createHmac('sha256', key).update(encodeFields(fields)).digest('base64url')
}

const DEFAULT_NAMESPACE = {
  machine: 'machine',
  principal: 'user',
  container: 'native',
  providerRoot: 'default'
}

const vectors = []

function add(name, options) {
  const {
    key = KEY_A,
    authorityDomainId = 'profile-1',
    namespace = DEFAULT_NAMESPACE,
    agent,
    sessionKey,
    sessionId,
    transcriptPath = null,
    canonicalWorktreeId = 'worktree-1'
  } = options
  const namespaceFields = [
    namespace.machine,
    namespace.principal,
    namespace.container,
    namespace.providerRoot
  ]
  const identityFields = [
    IDENTITY_LABEL,
    authorityDomainId,
    ...namespaceFields,
    agent,
    sessionKey,
    sessionId,
    agent === 'pi' || agent === 'prime-agent' ? (transcriptPath ?? '') : ''
  ]
  const worktreeFields = [
    WORKTREE_LABEL,
    authorityDomainId,
    ...namespaceFields,
    canonicalWorktreeId
  ]
  vectors.push({
    name,
    keyHex: key.toString('hex'),
    authorityDomainId,
    namespace,
    agent,
    sessionKey,
    sessionId,
    transcriptPath,
    canonicalWorktreeId,
    expectedKeyId: keyId(key),
    expectedIdentityDigest: hmacFields(key, identityFields),
    expectedWorktreeScopeDigest: hmacFields(key, worktreeFields)
  })
}

// Mirrors the admitted source suite case 1 inputs exactly (codex/session-1).
add('codex-session-1-worktree-1', {
  agent: 'codex',
  sessionKey: 'session_id',
  sessionId: 'session-1'
})
add('codex-session-1-worktree-2', {
  agent: 'codex',
  sessionKey: 'session_id',
  sessionId: 'session-1',
  canonicalWorktreeId: 'worktree-2'
})

// Every other supported resumable agent.
add('claude-transcript-ignored', {
  agent: 'claude',
  sessionKey: 'session_id',
  sessionId: 'claude-session',
  transcriptPath: '/home/u/.claude/projects/slug/real.jsonl'
})
add('gemini-session', { agent: 'gemini', sessionKey: 'session_id', sessionId: 'gemini-session' })
add('antigravity-conversation', {
  agent: 'antigravity',
  sessionKey: 'conversation_id',
  sessionId: 'agy-conversation'
})
add('opencode-session', {
  agent: 'opencode',
  sessionKey: 'session_id',
  sessionId: 'opencode-session'
})
add('pi-transcript', {
  agent: 'pi',
  sessionKey: 'session_id',
  sessionId: 'pi-session',
  transcriptPath: '/data/pi/session.jsonl'
})
add('prime-transcript', {
  agent: 'prime-agent',
  sessionKey: 'session_id',
  sessionId: 'prime-session-1',
  transcriptPath: '/data/prime/session.jsonl'
})
add('mimo-session', {
  agent: 'mimo-code',
  sessionKey: 'session_id',
  sessionId: 'mimo-session'
})
add('droid-session', { agent: 'droid', sessionKey: 'session_id', sessionId: 'droid-session' })
add('grok-session', { agent: 'grok', sessionKey: 'session_id', sessionId: 'grok-session' })
add('devin-session', { agent: 'devin', sessionKey: 'session_id', sessionId: 'devin-session' })
add('omp-session', { agent: 'omp', sessionKey: 'session_id', sessionId: 'omp-session' })
add('copilot-joined-resume', {
  agent: 'copilot',
  sessionKey: 'session_id',
  sessionId: '940237d9-c712-48e8-bca1-fd75fc4a8d4b'
})
add('kimi-session', {
  agent: 'kimi',
  sessionKey: 'session_id',
  sessionId: 'session_431324d7-2165-42f0-9ecd-9f93437b3201'
})

// Unicode and normalized-form ids (digest input is the already-trimmed id).
add('unicode-id', {
  agent: 'codex',
  sessionKey: 'session_id',
  sessionId: 'ses-ümlaut-会话-🚀'
})
add('trimmed-id-normalized-form', {
  agent: 'codex',
  sessionKey: 'session_id',
  sessionId: 'padded-id'
})

// Domain and namespace separation.
add('other-authority-domain', {
  authorityDomainId: 'profile-2',
  agent: 'codex',
  sessionKey: 'session_id',
  sessionId: 'session-1'
})
add('other-principal', {
  namespace: {
    machine: 'machine',
    principal: 'other-user',
    container: 'native',
    providerRoot: 'default'
  },
  agent: 'codex',
  sessionKey: 'session_id',
  sessionId: 'session-1'
})

// A different key derives a different key id and different digests.
add('second-key', {
  key: KEY_B,
  agent: 'codex',
  sessionKey: 'session_id',
  sessionId: 'session-1'
})

const output = {
  generator: 'generate-vectors.mjs',
  generatorSource: 'src/main/runtime/agent-session-claim-identity.ts',
  sourceRevision: SOURCE_REVISION,
  nodeVersion: process.version,
  keysAreTestOnly: true,
  vectors
}

writeFileSync(new URL('./vectors.json', import.meta.url), `${JSON.stringify(output, null, 2)}\n`)
console.log(`wrote ${vectors.length} vectors with node ${process.version}`)
