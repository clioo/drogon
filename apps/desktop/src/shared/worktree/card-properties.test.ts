import { describe, expect, it } from 'vitest'
import {
  COMPACT_WORKTREE_CARD_PROPERTIES,
  DEFAULT_WORKTREE_CARD_PROPERTIES,
  LEGACY_PORTS_ON_WORKTREE_CARD_PROPERTIES,
  TASK_WORKTREE_CARD_PROPERTIES,
  WORKTREE_CARD_PROPERTIES,
  getWorktreeCardModeProperties,
  getWorktreeCardModeUpdates,
  isDefaultedCompactWorktreeCardProperties,
  normalizeWorktreeCardProperties
} from './card-properties'

describe('worktree card properties', () => {
  it('defines Default with inline agents, without branch, and without ports', () => {
    const props = getWorktreeCardModeProperties('Default')

    expect(props).toContain('inline-agents')
    expect(props).not.toContain('branch')
    expect(props).not.toContain('ports')
    expect(props).toContain('pr')
    expect(props).toContain('automation')
    expect(props).toEqual(DEFAULT_WORKTREE_CARD_PROPERTIES)
  })

  it('names the source preset with default-on ports as the legacy payload', () => {
    expect(LEGACY_PORTS_ON_WORKTREE_CARD_PROPERTIES).toContain('ports')
    expect(LEGACY_PORTS_ON_WORKTREE_CARD_PROPERTIES.filter((id) => id !== 'ports')).toEqual(
      DEFAULT_WORKTREE_CARD_PROPERTIES
    )
  })

  it('keeps ports in the selectable domain so Show properties can re-enable it', () => {
    expect(WORKTREE_CARD_PROPERTIES).toContain('ports')
    expect(normalizeWorktreeCardProperties(['status', 'unread', 'ports'])).toEqual([
      'status',
      'unread',
      'ports'
    ])
  })

  it('defines Compact as the status-only quiet preset', () => {
    const props = getWorktreeCardModeProperties('Compact')

    expect(props).toEqual(['status'])
    expect(props).toEqual(COMPACT_WORKTREE_CARD_PROPERTIES)
    expect(props).not.toContain('inline-agents')
    expect(props).not.toContain('issue')
    expect(props).not.toContain('linear-issue')
    expect(props).not.toContain('jira-issue')
    expect(props).not.toContain('comment')
    expect(props).not.toContain('ports')
    expect(props).not.toContain('branch')
    expect(props).not.toContain('pr')
    expect(props).not.toContain('automation')
  })

  it('keeps status enabled in both presets', () => {
    expect(getWorktreeCardModeProperties('Default')).toEqual(expect.arrayContaining(['status']))
    expect(getWorktreeCardModeProperties('Compact')).toEqual(expect.arrayContaining(['status']))
  })

  it('keeps provider-specific task metadata together in Default mode', () => {
    expect(getWorktreeCardModeProperties('Default')).toEqual(
      expect.arrayContaining(TASK_WORKTREE_CARD_PROPERTIES)
    )
    expect(TASK_WORKTREE_CARD_PROPERTIES).toEqual(['issue', 'linear-issue', 'jira-issue'])
  })

  it('normalizes fixed and legacy properties while preserving selected properties', () => {
    expect(normalizeWorktreeCardProperties(['ci', 'branch', 'pr', 'automation', 'unread'])).toEqual(
      ['status', 'unread', 'ci', 'branch', 'pr', 'automation']
    )
  })

  it('returns combined mode update payloads', () => {
    expect(getWorktreeCardModeUpdates('Compact')).toEqual({
      settings: { compactWorktreeCards: true },
      ui: {
        worktreeCardProperties: getWorktreeCardModeProperties('Compact'),
        _worktreeCardModeDefaulted: true
      }
    })
  })

  it('recognizes only exact defaulted Compact presets', () => {
    expect(isDefaultedCompactWorktreeCardProperties(['status'])).toBe(true)
    expect(isDefaultedCompactWorktreeCardProperties(['status', 'unread'])).toBe(true)
    expect(isDefaultedCompactWorktreeCardProperties(['status', 'automation'])).toBe(true)
    expect(isDefaultedCompactWorktreeCardProperties(['status', 'unread', 'automation'])).toBe(true)
    expect(isDefaultedCompactWorktreeCardProperties(['automation', 'status'])).toBe(false)
    expect(isDefaultedCompactWorktreeCardProperties(['status', 'automation', 'pr'])).toBe(false)
  })
})
