import { describe, expect, it, vi } from 'vitest'
import {
  automationBelongsToBot,
  botResponsibilityHistory,
  migrateDrogonBotAutomationOwners
} from './bot-responsibility-owner'
import { BotService } from './bot-service'
import { BotPersistence } from '../persistence/loading-store/bot-persistence'
import { normalizeDrogonBot } from '../../shared/drogon-bot-contract'
import type { Automation, AutomationRun } from '../../shared/automations-types'
import type { PersistedState } from '../../shared/persisted-state-types'
import type { Store } from '../persistence'
import type { WriteFlushBarrierOperations } from '../persistence/loading-store/write-flush-barriers'
import { createAutomationRunWriter } from '../automations/automation-run-writer'
import { resolveBotAutomationDispatchContext } from './bot-automation-dispatch-context'

function makeBot() {
  const value = normalizeDrogonBot({
    id: 'bot-1',
    displayIdentity: { displayName: 'Night Watch' },
    harnessPolicy: { defaultHarness: 'codex', explicitModel: null },
    instructions: 'Watch.',
    memories: [],
    responsibilities: [
      {
        id: 'responsibility-1',
        name: 'Daily watch',
        instructions: 'Watch daily.',
        kind: 'scheduled',
        trigger: { kind: 'scheduled', automationId: 'automation-1' },
        enabled: true,
        recipe: {
          recipeRef: 'daily-watch.json',
          runId: 'mentu-run-3',
          evidencePath: '.mentu/runs/mentu-run-3/evidence.json'
        },
        createdAt: 1,
        updatedAt: 1
      }
    ],
    currentSession: null,
    createdAt: 1,
    updatedAt: 1
  })
  if (!value) {
    throw new Error('test bot was not normalized')
  }
  return value
}

const automation = { id: 'automation-1', botId: undefined } as unknown as Automation
const run = { id: 'run-1', automationId: 'automation-1' } as unknown as AutomationRun

describe('Bot responsibility ownership', () => {
  it('migrates scheduled responsibility ownership and run links', () => {
    const migrated = migrateDrogonBotAutomationOwners({
      bots: [makeBot()],
      automations: [automation],
      automationRuns: [run],
      botResponsibilityRuns: []
    })
    expect(migrated.changed).toBe(true)
    expect(migrated.state.automations[0]).toMatchObject({
      botId: 'bot-1'
    })
  })

  it('keeps a Bot automation in global administration while projecting Bot history', () => {
    const owned = { ...automation, botId: 'bot-1' }
    const responsibilityRun = {
      id: 'bot-run-1',
      botId: 'bot-1',
      responsibilityId: 'responsibility-1',
      automationId: 'automation-1',
      automationRunId: 'run-1',
      startedAt: 4,
      endedAt: null,
      recipe: makeBot().responsibilities[0].recipe,
      hostObservation: null
    }
    const state = {
      bots: [makeBot()],
      automations: [owned],
      automationRuns: [run],
      botResponsibilityRuns: [responsibilityRun]
    }
    expect(automationBelongsToBot(owned, 'bot-1')).toBe(true)
    expect(botResponsibilityHistory(state, 'bot-1')[0]).toMatchObject({
      automation: owned,
      automationRun: run,
      responsibilityRun: { recipe: { runId: 'mentu-run-3' } }
    })
  })

  it('drops a dangling owner from a legacy automation instead of inventing a Bot', () => {
    const migrated = migrateDrogonBotAutomationOwners({
      bots: [],
      automations: [{ ...automation, botId: 'deleted-bot' }],
      automationRuns: [],
      botResponsibilityRuns: []
    })
    expect(migrated.changed).toBe(true)
    expect(migrated.state.automations[0]).not.toHaveProperty('botId')
  })

  it('repairs mismatched owners and drops responsibilities whose automation is gone', () => {
    const secondBot = {
      ...makeBot(),
      id: 'bot-2',
      responsibilities: [
        {
          ...makeBot().responsibilities[0],
          id: 'responsibility-2',
          trigger: { kind: 'scheduled' as const, automationId: 'missing-automation' }
        }
      ]
    }
    const migrated = migrateDrogonBotAutomationOwners({
      bots: [makeBot(), secondBot],
      automations: [{ ...automation, botId: 'bot-2' }],
      automationRuns: [],
      botResponsibilityRuns: []
    })

    expect(migrated.state.automations[0]).toMatchObject({ botId: 'bot-1' })
    expect(migrated.state.bots?.[0]?.responsibilities).toHaveLength(1)
    expect(migrated.state.bots?.[1]?.responsibilities).toHaveLength(0)
  })

  it('persists a Bot mutation and rotates its session through the persistence domain', () => {
    const state = {
      bots: [],
      automations: [],
      automationRuns: [],
      botResponsibilityRuns: []
    } as unknown as PersistedState
    const flush = vi.fn()
    const persistence = new BotPersistence({ state }, {
      flush
    } as unknown as WriteFlushBarrierOperations)
    const created = persistence.createBot({
      characterPreset: 'none',
      displayIdentity: { displayName: 'Persistent Bot', handle: null, title: null },
      harnessPolicy: { defaultHarness: 'codex', explicitModel: null },
      instructions: 'Remember this.',
      memories: ['A memory'],
      currentSession: null
    })
    const rotated = persistence.rotateBotSession(created.id, {
      sessionId: 'tab-1',
      harness: 'codex',
      model: null,
      startedAt: 2
    })
    expect(persistence.listBots()[0]).toMatchObject({
      id: created.id,
      currentSession: { sessionId: 'tab-1' }
    })
    expect(state.bots).toHaveLength(1)
    expect(rotated.id).toBe(created.id)
    expect(flush).toHaveBeenCalled()
  })

  it('creates a scheduled responsibility as an Orca-owned automation', async () => {
    let currentBot = { ...makeBot(), responsibilities: [] }
    const automation = { id: 'automation-2' } as unknown as Automation
    const createAutomation = vi.fn(() => automation)
    const store = {
      getBot: () => currentBot,
      createAutomation,
      updateBot: vi.fn(
        (_id: string, updates: { responsibilities: typeof currentBot.responsibilities }) => {
          currentBot = { ...currentBot, responsibilities: updates.responsibilities }
          return currentBot
        }
      ),
      deleteAutomation: vi.fn()
    } as unknown as Store
    const service = new BotService(store, { runNow: vi.fn() })
    const result = service.createResponsibility('bot-1', {
      name: 'Daily watch',
      instructions: 'Run the watch.',
      kind: 'scheduled',
      schedule: {
        projectId: 'repo-1',
        workspaceMode: 'new_per_run',
        timezone: 'UTC',
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        dtstart: 100
      }
    })
    expect(createAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: 'bot-1',
        agentId: 'codex',
        prompt: expect.stringContaining('Persistent Drogon Bot identity')
      })
    )
    expect(result.responsibility.trigger).toEqual({
      kind: 'scheduled',
      automationId: 'automation-2'
    })
  })

  it('records scheduler-created runs in Bot history without replacing automation status', () => {
    const recordBotResponsibilityRun = vi.fn()
    const store = {
      createAutomationRun: vi.fn(
        () => ({ id: 'automation-run-1', automationId: 'automation-1' }) as AutomationRun
      ),
      getBot: () => makeBot(),
      recordBotResponsibilityRun,
      automationChangeSelector: vi.fn()
    } as unknown as Store
    createAutomationRunWriter(store, null).createRun(
      { ...automation, botId: 'bot-1' },
      10,
      'scheduled'
    )
    expect(recordBotResponsibilityRun).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: 'bot-1',
        responsibilityId: 'responsibility-1',
        automationRunId: 'automation-run-1',
        hostObservation: null
      })
    )
  })

  it('closes Bot history when the linked automation reaches a final status', () => {
    const responsibilityRun = {
      id: 'bot-run-1',
      botId: 'bot-1',
      responsibilityId: 'responsibility-1',
      automationId: 'automation-1',
      automationRunId: 'run-1',
      startedAt: 4,
      endedAt: null,
      recipe: null,
      hostObservation: null
    }
    const recordBotResponsibilityRun = vi.fn()
    const store = {
      updateAutomationRun: vi.fn(
        () => ({ ...run, status: 'completed' }) as unknown as AutomationRun
      ),
      listBotResponsibilityRuns: () => [responsibilityRun],
      recordBotResponsibilityRun,
      automationChangeSelector: vi.fn()
    } as unknown as Store

    createAutomationRunWriter(store, null).updateRun({ runId: 'run-1', status: 'completed' })

    expect(recordBotResponsibilityRun).toHaveBeenCalledWith(
      expect.objectContaining({ automationRunId: 'run-1', endedAt: expect.any(Number) })
    )
  })

  it('refuses to manually fake execution of a reactive responsibility', async () => {
    const reactiveBot = {
      ...makeBot(),
      responsibilities: [
        {
          ...makeBot().responsibilities[0],
          kind: 'reactive' as const,
          trigger: { kind: 'reactive' as const, event: 'pull-request.opened' }
        }
      ]
    }
    const service = new BotService({ getBot: () => reactiveBot } as unknown as Store, {
      runNow: vi.fn()
    })

    await expect(service.runResponsibility('bot-1', 'responsibility-1')).rejects.toThrow(
      'connected event adapter'
    )
  })

  it('hydrates current Bot identity and memory into every scheduled dispatch', () => {
    const currentBot = {
      ...makeBot(),
      instructions: 'Use the current standing instructions.',
      memories: ['The release branch changed.']
    }
    const hydrated = resolveBotAutomationDispatchContext(
      { getBot: () => currentBot },
      { ...automation, botId: 'bot-1', prompt: 'stale prompt', agentId: 'claude' }
    )

    expect(hydrated.agentId).toBe('codex')
    expect(hydrated.prompt).toContain('Use the current standing instructions.')
    expect(hydrated.prompt).toContain('The release branch changed.')
    expect(hydrated.prompt).toContain('Daily watch')
  })

  it('keeps scheduler history idempotent and rejects invented automation runs', () => {
    const state = {
      bots: [makeBot()],
      automations: [{ ...automation, botId: 'bot-1' }],
      automationRuns: [run],
      botResponsibilityRuns: []
    } as unknown as PersistedState
    const persistence = new BotPersistence({ state }, {
      flush: vi.fn()
    } as unknown as WriteFlushBarrierOperations)
    const input = {
      botId: 'bot-1',
      responsibilityId: 'responsibility-1',
      automationId: 'automation-1',
      automationRunId: 'run-1',
      startedAt: 4,
      endedAt: null,
      recipe: null,
      hostObservation: null
    } as const

    const first = persistence.recordBotResponsibilityRun(input)
    expect(persistence.recordBotResponsibilityRun(input).id).toBe(first.id)
    expect(persistence.listBotResponsibilityRuns()).toHaveLength(1)
    expect(() =>
      persistence.recordBotResponsibilityRun({ ...input, automationRunId: 'invented-run' })
    ).toThrow('existing automation run')
  })
})
