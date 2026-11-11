import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getNotificationRouting,
  hasAgentRunInSlot,
  markAgentRan,
  resolveAgentDisplayName,
  runAgentForUser,
  pushAssistantMessage,
} = vi.hoisted(() => ({
  getNotificationRouting: vi.fn(),
  hasAgentRunInSlot: vi.fn(),
  markAgentRan: vi.fn(),
  resolveAgentDisplayName: vi.fn(),
  runAgentForUser: vi.fn(),
  pushAssistantMessage: vi.fn(),
}))

vi.mock('@ak-system/api', () => ({
  getDefaultTriggerMessage: (agentId: string) => `default prompt for ${agentId}`,
  getNotificationRouting,
  hasAgentRunInSlot,
  markAgentRan,
  resolveAgentDisplayName,
  NOTIFICATION_TYPES: [
    { id: 'harness_insight', routable: true, defaultAgentId: '01_Hugo_orchestrator' },
    { id: 'task_reminder', routable: true },
  ],
}))
vi.mock('./agent-runner', () => ({ runAgentForUser }))
vi.mock('./push-notifications', () => ({ pushAssistantMessage }))

import { runEventAgentIfRouted } from './notification-event-runner'

beforeEach(() => {
  vi.clearAllMocks()
  hasAgentRunInSlot.mockResolvedValue(false)
  resolveAgentDisplayName.mockResolvedValue('הוגו')
  runAgentForUser.mockResolvedValue({ text: 'מה חשוב עכשיו: ...' })
})

describe('runEventAgentIfRouted — defaultAgentId', () => {
  it('runs the type default when the user has routed nothing', async () => {
    getNotificationRouting.mockResolvedValue({ agentId: null, triggerMessage: null })

    const res = await runEventAgentIfRouted('harness_insight', { context: 'insight lines' })

    expect(res).toMatchObject({ status: 'ran', agentId: '01_Hugo_orchestrator' })
    expect(runAgentForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: '01_Hugo_orchestrator',
        message: 'default prompt for 01_Hugo_orchestrator\n\ninsight lines',
      }),
    )
  })

  it('lets an explicit routing beat the default, including its custom prompt', async () => {
    getNotificationRouting.mockResolvedValue({
      agentId: '08_startup_coo',
      triggerMessage: 'custom instructions',
    })

    const res = await runEventAgentIfRouted('harness_insight', { context: 'insight lines' })

    expect(res).toMatchObject({ status: 'ran', agentId: '08_startup_coo' })
    expect(runAgentForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: '08_startup_coo',
        message: 'custom instructions\n\ninsight lines',
      }),
    )
  })

  it('ignores a stale trigger message left over from a cleared routing', async () => {
    getNotificationRouting.mockResolvedValue({ agentId: null, triggerMessage: 'orphaned text' })

    await runEventAgentIfRouted('harness_insight')

    expect(runAgentForUser).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'default prompt for 01_Hugo_orchestrator' }),
    )
  })

  it('still reports not_routed for a type without a default, so the caller runs its template', async () => {
    getNotificationRouting.mockResolvedValue({ agentId: null, triggerMessage: null })

    expect(await runEventAgentIfRouted('task_reminder')).toEqual({ status: 'not_routed' })
    expect(runAgentForUser).not.toHaveBeenCalled()
  })

  it('does not invent a default for an unknown type', async () => {
    getNotificationRouting.mockResolvedValue({ agentId: null, triggerMessage: null })

    expect(await runEventAgentIfRouted('no_such_event')).toEqual({ status: 'not_routed' })
  })

  it('honours dedupeSlot for the default agent too', async () => {
    getNotificationRouting.mockResolvedValue({ agentId: null, triggerMessage: null })
    hasAgentRunInSlot.mockResolvedValue(true)

    const res = await runEventAgentIfRouted('harness_insight', { dedupeSlot: '09:00' })

    expect(res).toEqual({ status: 'skipped_duplicate', agentId: '01_Hugo_orchestrator' })
    expect(runAgentForUser).not.toHaveBeenCalled()
  })
})
