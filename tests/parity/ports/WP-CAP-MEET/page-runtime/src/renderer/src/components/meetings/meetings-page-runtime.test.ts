// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrogonMeetingWorkspace } from '../../../../shared/drogon-meeting-contract'

const { launchAgentInNewTabMock, storeState } = vi.hoisted(() => ({
  launchAgentInNewTabMock: vi.fn(),
  storeState: {
    fetchProjectGroups: vi.fn(),
    fetchFolderWorkspaces: vi.fn(),
    setActiveFolderWorkspace: vi.fn(),
    ensureWorktreeRootGroup: vi.fn(() => 'group-1'),
    openFile: vi.fn(),
    setActiveView: vi.fn(),
    activeGroupIdByWorktree: {} as Record<string, string>
  }
}))

vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: launchAgentInNewTabMock
}))

vi.mock('@/store', () => ({
  useAppStore: { getState: () => storeState }
}))

import { askAboutMeetingThroughDrogon, mountMeetingThroughDrogon } from './meetings-page-runtime'

const policy = {
  agent: 'codex' as const,
  model: 'gpt-5.5',
  agentArgs: '--model gpt-5.5',
  source: 'drogon-settings' as const
}

function meeting(mounted = false): DrogonMeetingWorkspace {
  return {
    id: 'write-that-down:/Users/me/Transcripts/2026-09-04/10-15_5min.md',
    folderPath: '/Users/me/Transcripts/2026-09-04',
    transcript: {
      id: 'write-that-down:/Users/me/Transcripts/2026-09-04/10-15_5min.md',
      title: 'Planning',
      fileName: '10-15_5min.md',
      filePath: '/Users/me/Transcripts/2026-09-04/10-15_5min.md',
      folderPath: '/Users/me/Transcripts/2026-09-04',
      dateFolder: '2026-09-04',
      durationMinutes: 5,
      status: 'saved',
      preview: 'Decision recorded.'
    },
    status: 'saved',
    harnessPolicy: policy,
    ownership: 'write-that-down-read-only',
    workspaceKey: mounted ? 'folder:meeting-workspace' : null,
    ...(mounted
      ? {
          folderWorkspace: {
            id: 'meeting-workspace',
            projectGroupId: 'meetings-group',
            name: 'Planning',
            folderPath: '/Users/me/Transcripts/2026-09-04'
          }
        }
      : {})
  }
}

describe('Meetings page runtime', () => {
  const mountedMeeting = meeting(true)
  const authorizeExternalPath = vi.fn()
  const mount = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    storeState.fetchProjectGroups.mockResolvedValue(undefined)
    storeState.fetchFolderWorkspaces.mockResolvedValue(undefined)
    storeState.ensureWorktreeRootGroup.mockReturnValue('group-1')
    launchAgentInNewTabMock.mockReturnValue({ tabId: 'tab-1' })
    mount.mockResolvedValue(mountedMeeting)
    authorizeExternalPath.mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        meetings: { list: vi.fn(), mount },
        fs: { authorizeExternalPath }
      }
    })
  })

  it('opens the companion transcript through a local read-only editor tab', async () => {
    await expect(mountMeetingThroughDrogon(meeting(), policy)).resolves.toEqual(mountedMeeting)

    expect(storeState.openFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: mountedMeeting.transcript.filePath,
        mode: 'edit',
        readOnly: true,
        runtimeEnvironmentId: null
      }),
      expect.objectContaining({ suppressActiveRuntimeFallback: true })
    )
    expect(authorizeExternalPath).toHaveBeenCalledWith({
      targetPath: mountedMeeting.transcript.filePath
    })
  })

  it('asks through Drogon after mounting instead of invoking a companion provider', async () => {
    await askAboutMeetingThroughDrogon({
      meeting: meeting(),
      question: 'What was decided?',
      harnessPolicy: policy
    })

    expect(launchAgentInNewTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'codex',
        worktreeId: 'folder:meeting-workspace',
        initialCwd: mountedMeeting.folderPath,
        prompt: expect.stringContaining('What was decided?')
      })
    )
  })
})
