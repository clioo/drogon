import { describe, expect, it, vi } from 'vitest'
import { RateLimitService } from './service'
import { deferred, flushMicrotasks } from './rate-limit-service-test-harness'

vi.mock('./claude-fetcher', () => ({
  fetchClaudeRateLimits: vi.fn(), fetchManagedAccountUsage: vi.fn()
}))
vi.mock('./codex-fetcher', () => ({
  fetchCodexRateLimits: vi.fn(), consumeCodexRateLimitResetCredit: vi.fn()
}))
vi.mock('./gemini-usage-fetcher', () => ({ fetchGeminiRateLimits: vi.fn() }))
vi.mock('./kimi-fetcher', () => ({ fetchKimiRateLimits: vi.fn() }))
vi.mock('./minimax-fetcher', () => ({ fetchMiniMaxRateLimits: vi.fn() }))
vi.mock('./grok-fetcher', () => ({ fetchGrokRateLimits: vi.fn() }))
vi.mock('./opencode-go-usage-fetcher', () => ({ fetchOpenCodeGoRateLimits: vi.fn() }))
vi.mock('./grok-auth', () => ({ readGrokAuthSession: vi.fn(() => ({ status: 'missing' })) }))
vi.mock('../minimax/minimax-cookie-store', () => ({ hasMiniMaxSessionCookie: vi.fn(() => false) }))

type QueueBoundary = {
  fetchCodexOnly(options: { force: boolean }): Promise<void>
  fetchAll(options: { force: boolean }): Promise<void>
  runFetchCodexOnlyCycle(signal: AbortSignal): Promise<void>
  runFetchAllCycle(signal: AbortSignal): Promise<void>
  isFetching: boolean
  codexOnlyFetchQueued: boolean
  fullFetchQueued: boolean
}

describe('pinned source queue characterization, not intended rewrite behavior', () => {
  it('leaves a forced Codex follow-up pending after a queued full cycle', async () => {
    const service = new RateLimitService()
    const queue = service as unknown as QueueBoundary
    const first = deferred<void>()
    const full = deferred<void>()
    const codexCycle = vi.spyOn(queue, 'runFetchCodexOnlyCycle')
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined)
    const fullCycle = vi.spyOn(queue, 'runFetchAllCycle')
      .mockImplementationOnce(() => full.promise)

    const running = queue.fetchCodexOnly({ force: true })
    let fullResolved = false
    let followupResolved = false
    const queuedFull = queue.fetchAll({ force: true }).then(() => { fullResolved = true })
    const queuedCodex = queue.fetchCodexOnly({ force: true }).then(() => { followupResolved = true })

    try {
      expect(queue.fullFetchQueued).toBe(true)
      expect(queue.codexOnlyFetchQueued).toBe(true)
      first.resolve()
      await flushMicrotasks(12)
      expect(fullCycle).toHaveBeenCalledOnce()
      full.resolve()
      await running
      await flushMicrotasks(12)

      expect(codexCycle).toHaveBeenCalledOnce()
      expect(queue.isFetching).toBe(false)
      expect(queue.fullFetchQueued).toBe(false)
      expect(queue.codexOnlyFetchQueued).toBe(true)
      expect(fullResolved).toBe(false)
      expect(followupResolved).toBe(false)
    } finally {
      first.resolve()
      full.resolve()
      service.stop()
      await Promise.all([running, queuedFull, queuedCodex])
      vi.restoreAllMocks()
    }
    expect(fullResolved).toBe(true)
    expect(followupResolved).toBe(true)
  })
})
