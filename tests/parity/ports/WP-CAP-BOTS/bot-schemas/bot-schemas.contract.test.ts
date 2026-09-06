// Port provenance: Lovecast Inc. MIT source at c97906287bb7a390b25e2025b600d9fb3c25d9c3.
// Original: src/main/ipc/bot-schemas.test.ts (SHA256 ceeed197fc9ed3d6835a6d089d918f1140d7e6c94d142e0a8a3aae373ce284f6).
import { describe, expect, it } from 'vitest'
import { parseBotCreate, parseBotSession, parseResponsibilityCreate } from './candidate-binding'

describe('Bot IPC schemas', () => {
  it('accepts a bounded Bot create payload with harness-default model policy', () => {
    expect(
      parseBotCreate({
        characterPreset: 'samwell',
        displayIdentity: { displayName: 'Archivist', handle: null, title: 'Researcher' },
        harnessPolicy: { defaultHarness: 'codex', explicitModel: null },
        instructions: 'Keep evidence linked.',
        memories: []
      })
    ).toMatchObject({
      characterPreset: 'samwell',
      harnessPolicy: { defaultHarness: 'codex', explicitModel: null }
    })
  })

  it('rejects unsupported harnesses and undeclared payload fields', () => {
    expect(() =>
      parseBotSession({
        sessionId: 'session-1',
        harness: 'invented-harness',
        model: null,
        startedAt: 1
      })
    ).toThrow()
    expect(() =>
      parseBotCreate({
        characterPreset: 'none',
        displayIdentity: { displayName: 'Watcher', handle: null, title: null },
        harnessPolicy: { defaultHarness: 'codex', explicitModel: null },
        instructions: '',
        memories: [],
        privileged: true
      })
    ).toThrow()
    expect(() =>
      parseBotCreate({
        characterPreset: 'none',
        displayIdentity: { displayName: 'Watcher', handle: null, title: null },
        harnessPolicy: { defaultHarness: 'codex', explicitModel: null },
        instructions: '',
        memories: [],
        responsibilities: [{ id: 'renderer-invented-responsibility' }]
      })
    ).toThrow()
  })

  it('validates responsibility trigger semantics at the IPC boundary', () => {
    expect(
      parseResponsibilityCreate({
        name: 'Daily watch',
        instructions: 'Inspect the workspace.',
        kind: 'scheduled',
        schedule: {
          projectId: 'repo-1',
          workspaceMode: 'new_per_run',
          timezone: 'UTC',
          rrule: 'FREQ=DAILY',
          dtstart: 1
        }
      })
    ).toMatchObject({ kind: 'scheduled', schedule: { projectId: 'repo-1' } })
    expect(() =>
      parseResponsibilityCreate({
        name: 'Invalid reactive schedule',
        instructions: 'Do not accept mixed trigger semantics.',
        kind: 'reactive',
        schedule: {
          projectId: 'repo-1',
          workspaceMode: 'new_per_run',
          timezone: 'UTC',
          rrule: 'FREQ=DAILY',
          dtstart: 1
        }
      })
    ).toThrow()
  })
})
