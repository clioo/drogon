// @vitest-environment happy-dom
// Port provenance: Lovecast Inc. MIT source at c97906287bb7a390b25e2025b600d9fb3c25d9c3.
// Original: src/renderer/src/components/bots/BotsPage.test.tsx (SHA256 bd056caf58c50dc0f3f09ebc9729db05153bd15d48d5cc9a1481a544739d264f).

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BotsPage, { type DrogonBot, type DrogonBotsSnapshot } from './candidate-binding'

const storeMock = vi.hoisted(() => ({
  state: { closeBotsPage: vi.fn() }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof storeMock.state) => unknown) => selector(storeMock.state)
}))

afterEach(() => {
  cleanup()
  storeMock.state.closeBotsPage.mockReset()
})

const emptySnapshot: DrogonBotsSnapshot = { bots: [], history: [], availableHarnesses: [] }

function bot(id: string, displayName: string, responsibilityName: string): DrogonBot {
  return {
    id,
    characterPreset: 'none',
    displayIdentity: { displayName, handle: null, title: null },
    harnessPolicy: { defaultHarness: 'codex', explicitModel: null },
    instructions: '',
    memories: [],
    responsibilities: [
      {
        id: `${id}-responsibility`,
        name: responsibilityName,
        instructions: 'Inspect the workspace.',
        kind: 'scheduled',
        trigger: { kind: 'scheduled', automationId: `${id}-automation` },
        enabled: true,
        recipe: null,
        createdAt: 1,
        updatedAt: 1
      }
    ],
    currentSession: null,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('BotsPage', () => {
  it.each([
    { title: 'Reviewer', instructions: 'Review changes', expected: 'Reviewer' },
    { title: null, instructions: 'Review changes', expected: 'Review changes' },
    { title: null, instructions: '', expected: 'Ready for a purpose' }
  ])(
    'renders the Bot description fallback: $expected',
    async ({ title, instructions, expected }) => {
      const item = bot('description-bot', 'Watcher', 'Review duty')
      item.displayIdentity.title = title
      item.instructions = instructions
      render(<BotsPage loadSnapshot={async () => ({ ...emptySnapshot, bots: [item] })} />)
      expect(await screen.findByText(expected)).toBeTruthy()
    }
  )

  it('renders an actionable empty state', async () => {
    render(<BotsPage loadSnapshot={async () => emptySnapshot} />)
    await waitFor(() => expect(screen.getByText('No Bots yet')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Create Bot' })).toBeTruthy()
  })

  it('keeps model selection at the harness default and applies a real character preset', async () => {
    render(
      <BotsPage loadSnapshot={async () => ({ ...emptySnapshot, availableHarnesses: ['codex'] })} />
    )
    await screen.findByText('No Bots yet')
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    const model = screen.getByLabelText('Model') as HTMLInputElement
    expect(model.value).toBe('Harness default')
    expect(model.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Character preset'), { target: { value: 'arya' } })
    expect((screen.getByLabelText('Instructions') as HTMLTextAreaElement).value).toBe(
      'Focused, terse, autonomous, and execution-oriented.'
    )
  })

  it('does not invent a harness when discovery returns none', async () => {
    render(<BotsPage loadSnapshot={async () => emptySnapshot} />)
    await screen.findByText('No Bots yet')
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Watcher' } })

    expect((screen.getByLabelText('Default harness') as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Save Bot' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    expect(screen.getByText(/Install or refresh a supported harness/)).toBeTruthy()
  })

  it('runs a responsibility through the Bot card that owns it', async () => {
    const runResponsibility = vi.fn(async () => undefined)
    render(
      <BotsPage
        loadSnapshot={async () => ({
          bots: [
            bot('bot-1', 'First Bot', 'First duty'),
            bot('bot-2', 'Second Bot', 'Second duty')
          ],
          history: [],
          availableHarnesses: ['codex']
        })}
        runResponsibility={runResponsibility}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Run Second duty' }))

    await waitFor(() =>
      expect(runResponsibility).toHaveBeenCalledWith({
        botId: 'bot-2',
        responsibilityId: 'bot-2-responsibility'
      })
    )
  })

  it('renders a recoverable error state', async () => {
    render(
      <BotsPage
        loadSnapshot={async () => {
          throw new Error('profile unavailable')
        }}
      />
    )
    await waitFor(() => expect(screen.getByText('Bots could not be loaded')).toBeTruthy())
    expect(screen.getByText('profile unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
