// Port provenance: Lovecast Inc. MIT source at c97906287bb7a390b25e2025b600d9fb3c25d9c3.
// Original: src/main/bots/bot-reactive-dispatch.test.ts (SHA256 ad6eddd2749c20af80665b57410ed67f3ae3776831bded290091cc0349e8a0a0).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BotReactiveDispatchService,
  createDeterministicDispatchReceipt,
  DEFAULT_BOT_REACTIVE_DISPATCH_TIMEOUT_MS,
  normalizeBotReactiveEventKey,
  type BotReactiveDispatchReceipt,
  type BotReactiveDispatchReceiptRepository,
  type BotReactiveNormalizedEvent,
  type BotReactiveResponsibilityConfig,
  type BotReactiveSessionGateway
} from './candidate-binding'

function eventFixture(
  overrides: Partial<BotReactiveNormalizedEvent> = {}
): BotReactiveNormalizedEvent {
  return {
    provider: 'github',
    eventId: 'evt-1',
    trigger: 'pull_request.opened',
    repositoryId: 'repo-1',
    mentions: ['@bot'],
    authenticated: true,
    ...overrides
  }
}

function configFixture(
  overrides: Partial<BotReactiveResponsibilityConfig> = {}
): BotReactiveResponsibilityConfig {
  return {
    botId: 'bot-1',
    responsibilityId: 'resp-1',
    trigger: 'pull_request.opened',
    enabled: true,
    tested: true,
    configIdentity: 'cfg-v1',
    scope: {
      provider: 'github',
      repositoryIds: ['repo-1'],
      mentionHandles: ['bot']
    },
    ...overrides
  }
}

class FakeReceiptRepository implements BotReactiveDispatchReceiptRepository {
  private readonly byEventKey = new Map<string, string>()
  private readonly byId = new Map<string, BotReactiveDispatchReceipt>()
  private readonly patchFailureQueue: boolean[]

  constructor(
    private readonly admitFail = false,
    patchFailureQueue: boolean[] = []
  ) {
    this.patchFailureQueue = [...patchFailureQueue]
  }

  async admit(input: {
    event: BotReactiveNormalizedEvent
    config: BotReactiveResponsibilityConfig
    eventKey: string
    dispatchGatewayIdempotencyKey: string
    now: number
  }): Promise<{ receipt: BotReactiveDispatchReceipt; inserted: boolean }> {
    if (this.admitFail) {
      throw new Error('receipt store is unavailable')
    }
    const existingId = this.byEventKey.get(input.eventKey)
    if (existingId) {
      const existing = this.byId.get(existingId)
      if (!existing) {
        throw new Error('receipt index drift')
      }
      return { inserted: false, receipt: existing }
    }

    const created = createDeterministicDispatchReceipt({
      eventKey: input.eventKey,
      config: input.config,
      event: input.event,
      dispatchGatewayIdempotencyKey: input.dispatchGatewayIdempotencyKey,
      now: input.now
    })
    this.byEventKey.set(input.eventKey, created.id)
    this.byId.set(created.id, created)
    return { inserted: true, receipt: created }
  }

  async patchReceipt(
    id: string,
    patch: {
      state?: BotReactiveDispatchReceipt['state']
      attempts?: number
      sessionId?: string | null
      hostObservation?: BotReactiveDispatchReceipt['hostObservation']
      failureReason?: string | null
      now: number
    }
  ): Promise<BotReactiveDispatchReceipt> {
    if (this.patchFailureQueue.shift()) {
      throw new Error('receipt store is unavailable')
    }
    const current = this.byId.get(id)
    if (!current) {
      throw new Error('missing receipt')
    }
    const updated = {
      ...current,
      ...patch,
      attempts: patch.attempts ?? current.attempts,
      updatedAt: patch.now
    }
    this.byId.set(id, updated)
    return updated
  }

  async getById(id: string): Promise<BotReactiveDispatchReceipt | null> {
    return this.byId.get(id) ?? null
  }
}

function deferredGatewayResponse() {
  let resolve!: (value: {
    sessionId: string
    hostObservation: 'live' | 'unverifiable' | 'exited'
  }) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<{
    sessionId: string
    hostObservation: 'live' | 'unverifiable' | 'exited'
  }>((resolvePayload, rejectPayload) => {
    resolve = resolvePayload
    reject = rejectPayload
  })
  return { promise, resolve, reject }
}

describe('BotReactiveDispatchService foundation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dispatches only matching, enabled, tested, in-scope, mention-eligible events', async () => {
    const repository = new FakeReceiptRepository()
    const gateway: BotReactiveSessionGateway = {
      dispatch: vi.fn<BotReactiveSessionGateway['dispatch']>()
    }
    const service = new BotReactiveDispatchService(repository, gateway)

    const disabled = await service.dispatch(
      eventFixture({ authenticated: true }),
      configFixture({ enabled: false })
    )
    expect(disabled).toMatchObject({ kind: 'ignored', reason: 'disabled' })

    const outOfScope = await service.dispatch(
      eventFixture({ repositoryId: 'repo-2' }),
      configFixture()
    )
    expect(outOfScope).toMatchObject({ kind: 'ignored', reason: 'repository_mismatch' })

    expect(gateway.dispatch).not.toHaveBeenCalled()
  })

  it.each([
    ['null event', null, configFixture()],
    ['primitive event', 'not-an-object', configFixture()],
    ['null config', eventFixture(), null],
    ['primitive config', eventFixture(), 42],
    [
      'non-boolean enabled',
      eventFixture(),
      configFixture({ enabled: 'true' as unknown as boolean })
    ],
    [
      'non-array mentions',
      eventFixture({ mentions: 'bot' as unknown as string[] }),
      configFixture()
    ],
    [
      'empty repositoryIds',
      eventFixture(),
      configFixture({ scope: { ...configFixture().scope, repositoryIds: [] } })
    ],
    [
      'empty mentionHandles',
      eventFixture(),
      configFixture({ scope: { ...configFixture().scope, mentionHandles: [] } })
    ],
    [
      'mentionHandles that normalize to empty',
      eventFixture(),
      configFixture({ scope: { ...configFixture().scope, mentionHandles: ['@', '  '] } })
    ],
    [
      'mentionHandles that are only @/whitespace once trimmed',
      eventFixture(),
      configFixture({ scope: { ...configFixture().scope, mentionHandles: [' @@ '] } })
    ],
    ['whitespace-only botId', eventFixture(), configFixture({ botId: '   ' })],
    ['whitespace-only eventId', eventFixture({ eventId: '  ' }), configFixture()]
  ])('rejects malformed runtime input as invalid_config: %s', async (_label, event, config) => {
    const repository = new FakeReceiptRepository()
    const admitSpy = vi.spyOn(repository, 'admit')
    const gateway: BotReactiveSessionGateway = {
      dispatch: vi.fn<BotReactiveSessionGateway['dispatch']>()
    }
    const service = new BotReactiveDispatchService(repository, gateway)

    const result = await service.dispatch(
      event as unknown as BotReactiveNormalizedEvent,
      config as unknown as BotReactiveResponsibilityConfig
    )

    expect(result).toMatchObject({ kind: 'ignored', reason: 'invalid_config' })
    expect(admitSpy).not.toHaveBeenCalled()
    expect(gateway.dispatch).not.toHaveBeenCalled()
  })

  it('matches a padded, differently-cased mention handle against a padded configured handle', async () => {
    const repository = new FakeReceiptRepository()
    const gateway: BotReactiveSessionGateway = {
      dispatch: vi.fn(async () => ({ sessionId: 'session-1', hostObservation: 'live' as const }))
    }
    const service = new BotReactiveDispatchService(repository, gateway)

    const result = await service.dispatch(
      eventFixture({ mentions: [' @Tyrion '] }),
      configFixture({ scope: { ...configFixture().scope, mentionHandles: [' tyrion '] } })
    )

    expect(result.kind).toBe('dispatched')
    expect(gateway.dispatch).toHaveBeenCalledTimes(1)
  })

  it('keeps accepted receipts tied to deterministic bot/repo/provider/responsibility/event keying', () => {
    const keyA = normalizeBotReactiveEventKey('bot-1', 'GitHub', 'Repo-1', 'resp-1', 'evt-1')
    const keyB = normalizeBotReactiveEventKey('bot-1', 'github', 'Repo-1', 'resp-1', 'evt-1')
    const keyCaseSensitiveRepo = normalizeBotReactiveEventKey(
      'bot-1',
      'github',
      'repo-1',
      'resp-1',
      'evt-1'
    )
    const keyDifferentResponsibility = normalizeBotReactiveEventKey(
      'bot-1',
      'github',
      'Repo-1',
      'resp-2',
      'evt-1'
    )
    const keyDifferentRepo = normalizeBotReactiveEventKey(
      'bot-1',
      'github',
      'Repo-2',
      'resp-1',
      'evt-1'
    )
    const keyDifferentBot = normalizeBotReactiveEventKey(
      'bot-2',
      'github',
      'Repo-1',
      'resp-1',
      'evt-1'
    )

    // Provider casing is generic/owned normalization; repositoryId/eventId case is opaque and preserved.
    expect(keyA).toBe(keyB)
    expect(keyA).not.toBe(keyCaseSensitiveRepo)
    expect(keyA).not.toBe(keyDifferentResponsibility)
    expect(keyA).not.toBe(keyDifferentRepo)
    expect(keyA).not.toBe(keyDifferentBot)
  })

  it('isolates otherwise-identical event/responsibility pairs across different bots', async () => {
    const repository = new FakeReceiptRepository()
    const gateway: BotReactiveSessionGateway = {
      dispatch: vi.fn(async () => ({ sessionId: 'session-1', hostObservation: 'live' as const }))
    }
    const service = new BotReactiveDispatchService(repository, gateway)
    const event = eventFixture()

    const first = await service.dispatch(event, configFixture({ botId: 'bot-a' }))
    const second = await service.dispatch(event, configFixture({ botId: 'bot-b' }))

    expect(first.kind).toBe('dispatched')
    expect(second.kind).toBe('dispatched')
    expect(gateway.dispatch).toHaveBeenCalledTimes(2)
  })

  it('creates deterministic event keys and deduplicates concurrent duplicate calls', async () => {
    const repository = new FakeReceiptRepository()
    const calls = new Set<string>()
    const gateway: BotReactiveSessionGateway = {
      dispatch: vi.fn(async (input) => {
        calls.add(input.dispatchGatewayIdempotencyKey)
        await Promise.resolve()
        return { sessionId: `session-${calls.size}`, hostObservation: 'live' as const }
      })
    }
    const service = new BotReactiveDispatchService(repository, gateway)
    const event = eventFixture()
    const config = configFixture()

    const results = await Promise.all([
      service.dispatch(event, config),
      service.dispatch(event, config)
    ])

    expect([...calls]).toHaveLength(1)
    expect(results.filter((result) => result.kind === 'dispatched')).toHaveLength(1)
    expect(results.map((result) => result.kind)).toContain('in_progress')
  })

  it('reports an explicit storage_failed with zero gateway calls when admission cannot persist', async () => {
    const repository = new FakeReceiptRepository(true)
    const gateway: BotReactiveSessionGateway = {
      dispatch: vi.fn<BotReactiveSessionGateway['dispatch']>()
    }
    const service = new BotReactiveDispatchService(repository, gateway)

    const result = await service.dispatch(eventFixture(), configFixture())

    expect(result).toMatchObject({ kind: 'storage_failed' })
    if (result.kind === 'storage_failed') {
      expect(result.reason).toContain('persist dispatch admission')
    }
    expect(gateway.dispatch).not.toHaveBeenCalled()
  })

  it('fails with zero gateway calls when the pre-dispatch attempt cannot be persisted', async () => {
    const repository = new FakeReceiptRepository(false, [true])
    const gateway: BotReactiveSessionGateway = {
      dispatch: vi.fn<BotReactiveSessionGateway['dispatch']>()
    }
    const service = new BotReactiveDispatchService(repository, gateway)

    const result = await service.dispatch(eventFixture(), configFixture())

    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      expect(result.reason).toContain('Gateway was not invoked')
      expect(result.receipt.state).toBe('pending')
    }
    expect(gateway.dispatch).not.toHaveBeenCalled()
  })

  it('marks an ambiguous timeout and keeps pending receipt without duplicate delegation on retry', async () => {
    const repository = new FakeReceiptRepository()
    const deferred = deferredGatewayResponse()
    const gateway: BotReactiveSessionGateway = { dispatch: vi.fn(() => deferred.promise) }
    const service = new BotReactiveDispatchService(repository, gateway, { dispatchTimeoutMs: 20 })

    const first = await service.dispatch(eventFixture(), configFixture())
    expect(first).toMatchObject({ kind: 'in_progress', reason: 'ambiguous' })
    if (first.kind === 'in_progress') {
      expect(first.receipt.state).toBe('ambiguous')
    }
    expect(gateway.dispatch).toHaveBeenCalledTimes(1)

    const second = await service.dispatch(eventFixture(), configFixture())
    expect(second).toMatchObject({ kind: 'in_progress', reason: 'ambiguous' })
    expect(gateway.dispatch).toHaveBeenCalledTimes(1)
  })

  it('never retries an ambiguous receipt by elapsed time, even far in the future', async () => {
    const repository = new FakeReceiptRepository()
    const deferred = deferredGatewayResponse()
    const gateway: BotReactiveSessionGateway = { dispatch: vi.fn(() => deferred.promise) }
    let clock = 0
    const service = new BotReactiveDispatchService(repository, gateway, {
      dispatchTimeoutMs: 20,
      now: () => clock
    })

    await service.dispatch(eventFixture(), configFixture())
    expect(gateway.dispatch).toHaveBeenCalledTimes(1)

    clock = Number.MAX_SAFE_INTEGER / 2
    const later = await service.dispatch(eventFixture(), configFixture())

    expect(later).toMatchObject({ kind: 'in_progress', reason: 'ambiguous' })
    expect(gateway.dispatch).toHaveBeenCalledTimes(1)
  })

  it('does not act on a late ack that resolves after the dispatch already timed out', async () => {
    const repository = new FakeReceiptRepository()
    const deferred = deferredGatewayResponse()
    const gateway: BotReactiveSessionGateway = { dispatch: vi.fn(() => deferred.promise) }
    const service = new BotReactiveDispatchService(repository, gateway, { dispatchTimeoutMs: 10 })

    const timedOut = await service.dispatch(eventFixture(), configFixture())
    expect(timedOut).toMatchObject({ kind: 'in_progress', reason: 'ambiguous' })
    const receiptId = timedOut.kind === 'in_progress' ? timedOut.receipt.id : ''

    deferred.resolve({ sessionId: 'late-session', hostObservation: 'live' })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const stored = await repository.getById(receiptId)
    expect(stored?.state).toBe('ambiguous')
    expect(stored?.sessionId).toBeNull()
    expect(gateway.dispatch).toHaveBeenCalledTimes(1)
  })

  it('treats a malformed gateway acknowledgement as ambiguous, not a definite failure', async () => {
    const repository = new FakeReceiptRepository()
    const gateway: BotReactiveSessionGateway = {
      dispatch: vi.fn(async () => ({ sessionId: '', hostObservation: 'live' as const }))
    }
    const service = new BotReactiveDispatchService(repository, gateway)

    const result = await service.dispatch(eventFixture(), configFixture())

    expect(result).toMatchObject({ kind: 'in_progress', reason: 'ambiguous' })
    if (result.kind === 'in_progress') {
      expect(result.receipt.state).toBe('ambiguous')
      expect(result.receipt.sessionId).toBeNull()
      expect(result.receipt.hostObservation).toBe('unverifiable')
    }
  })

  it('treats an invalid hostObservation verdict as ambiguous, not a definite failure', async () => {
    const repository = new FakeReceiptRepository()
    const gateway: BotReactiveSessionGateway = {
      dispatch: vi.fn(async () => ({
        sessionId: 'ok',
        hostObservation: 'unknown' as unknown as 'live'
      }))
    }
    const service = new BotReactiveDispatchService(repository, gateway)

    const result = await service.dispatch(eventFixture(), configFixture())

    expect(result).toMatchObject({ kind: 'in_progress', reason: 'ambiguous' })
  })

  it('treats an asynchronous gateway rejection as ambiguous, not a definite failure', async () => {
    const repository = new FakeReceiptRepository()
    const gateway: BotReactiveSessionGateway = {
      dispatch: vi.fn(async () => {
        throw new Error('unreachable gateway')
      })
    }
    const service = new BotReactiveDispatchService(repository, gateway)

    const result = await service.dispatch(eventFixture(), configFixture())

    expect(result).toMatchObject({ kind: 'in_progress', reason: 'ambiguous' })
    if (result.kind === 'in_progress') {
      expect(result.receipt.hostObservation).toBe('unverifiable')
      expect(result.receipt.failureReason).toContain('unreachable gateway')
    }
  })

  it('treats a gateway that throws synchronously as ambiguous rather than an uncaught rejection', async () => {
    const repository = new FakeReceiptRepository()
    const gateway: BotReactiveSessionGateway = {
      dispatch: vi.fn(() => {
        throw new Error('synchronous gateway failure')
      })
    }
    const service = new BotReactiveDispatchService(repository, gateway)

    await expect(service.dispatch(eventFixture(), configFixture())).resolves.toMatchObject({
      kind: 'in_progress',
      reason: 'ambiguous'
    })
  })

  it('preserves confirmed dispatch evidence when persistence fails after a successful ack', async () => {
    const repository = new FakeReceiptRepository(false, [false, true])
    const gateway: BotReactiveSessionGateway = {
      dispatch: vi.fn(async () => ({ sessionId: 'session-live', hostObservation: 'live' as const }))
    }
    const service = new BotReactiveDispatchService(repository, gateway)

    const result = await service.dispatch(eventFixture(), configFixture())

    expect(result).toMatchObject({ kind: 'dispatched', persisted: false })
    if (result.kind === 'dispatched') {
      expect(result.receipt.state).toBe('dispatched')
      expect(result.receipt.sessionId).toBe('session-live')
      expect(result.receipt.hostObservation).toBe('live')
    }

    const secondCall = await service.dispatch(eventFixture(), configFixture())
    expect(secondCall.kind).toBe('in_progress')
    expect(gateway.dispatch).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-finite or non-positive dispatchTimeoutMs override', () => {
    const repository = new FakeReceiptRepository()
    const gateway: BotReactiveSessionGateway = {
      dispatch: vi.fn<BotReactiveSessionGateway['dispatch']>()
    }

    for (const invalid of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => new BotReactiveDispatchService(repository, gateway, { dispatchTimeoutMs: invalid })
      ).toThrow()
    }
  })

  it('defaults to a finite, positive dispatch timeout', () => {
    expect(Number.isFinite(DEFAULT_BOT_REACTIVE_DISPATCH_TIMEOUT_MS)).toBe(true)
    expect(DEFAULT_BOT_REACTIVE_DISPATCH_TIMEOUT_MS).toBeGreaterThan(0)
  })
})
