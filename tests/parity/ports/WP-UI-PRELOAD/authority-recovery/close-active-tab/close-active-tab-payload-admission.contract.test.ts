// Port provenance: Lovecast Inc. MIT source at c97906287bb7a390b25e2025b600d9fb3c25d9c3.
// Original: src/preload/close-active-tab-payload-admission.test.ts (SHA256 e42939244be46cea70ac2a0164114b70e1d127e6853b7dec9a418e75039f3708).

import { describe, expect, it } from 'vitest'
import { admitCloseActiveTabPayload } from '../../../../../../apps/desktop/src/preload/close-active-tab-payload-admission'

describe('admitCloseActiveTabPayload', () => {
  it('preserves the legacy omitted payload', () => {
    expect(admitCloseActiveTabPayload(undefined)).toEqual({ kind: 'legacy' })
  })

  it('admits a nonempty source id', () => {
    expect(admitCloseActiveTabPayload({ sourceId: 'page-1' })).toEqual({
      kind: 'source',
      payload: { sourceId: 'page-1' }
    })
  })

  it.each([null, {}, [], { sourceId: '' }, { sourceId: 1 }, 'page-1'])(
    'rejects malformed payload %#',
    (payload) => {
      expect(admitCloseActiveTabPayload(payload)).toEqual({ kind: 'invalid' })
    }
  )
})
