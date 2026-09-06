import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getClients: vi.fn(), clearToken: vi.fn(), isAuthError: vi.fn() }))
vi.mock('./client', () => ({ getClients: mocks.getClients, isAuthError: mocks.isAuthError }))
vi.mock('./linear-token-store', () => ({ clearToken: mocks.clearToken }))

async function microtasks() {
  for (let i = 0; i < 16; i++) await Promise.resolve()
}

describe('pinned Linear source characterization, not intended rewrite behavior', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.isAuthError.mockReturnValue(true)
  })

  it.each(['listTeams', 'listTeamsOrThrow'] as const)(
    '%s waits for admission; only the throwing route retains its permit until settlement',
    async (method) => {
      const limiter = await import('./linear-request-concurrency')
      const readers = await import('./teams')
      const response = Promise.withResolvers<{ nodes: never[]; pageInfo: { hasNextPage: false } }>()
      const fetch = vi.fn(() => response.promise)
      mocks.getClients.mockReturnValue([{
        workspace: { id: 'synthetic-workspace', organizationName: 'Synthetic' },
        client: { teams: fetch }
      }])
      for (let i = 0; i < 4; i++) await limiter.acquire()
      let held = 4
      let probeAcquired = false
      let probe: Promise<void> | undefined
      const request = readers[method]('synthetic-workspace')
      try {
        await microtasks()
        expect(fetch).not.toHaveBeenCalled()
        limiter.release()
        held--
        await microtasks()
        expect(fetch).toHaveBeenCalledOnce()
        probe = limiter.acquire().then(() => { probeAcquired = true })
        await microtasks()
        expect(probeAcquired).toBe(method === 'listTeams')
      } finally {
        response.resolve({ nodes: [], pageInfo: { hasNextPage: false } })
        await request
        await probe
        if (probeAcquired) limiter.release()
        while (held-- > 0) limiter.release()
      }
    }
  )

  it.each(['listTeams', 'listTeamsOrThrow'] as const)(
    '%s async rejection reaches local auth cleanup only in the throwing route',
    async (method) => {
      const readers = await import('./teams')
      const error = new Error('synthetic auth rejection')
      mocks.getClients.mockReturnValue([{
        workspace: { id: 'synthetic-workspace', organizationName: 'Synthetic' },
        client: { teams: vi.fn().mockRejectedValue(error) }
      }])
      await expect(readers[method]('synthetic-workspace')).rejects.toBe(error)
      expect(mocks.clearToken).toHaveBeenCalledTimes(method === 'listTeams' ? 0 : 1)
      if (method === 'listTeamsOrThrow') expect(mocks.clearToken).toHaveBeenCalledWith('synthetic-workspace')
    }
  )
})
