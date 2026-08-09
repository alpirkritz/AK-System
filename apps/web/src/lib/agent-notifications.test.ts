import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  notifyNotionInbox,
  sendBrowserPush,
  sendMobilePush,
  createNotification,
  resolveAgentDisplayName,
  resolveNotificationChannels,
  agentNotifiesNotion,
} = vi.hoisted(() => ({
  notifyNotionInbox: vi.fn(),
  sendBrowserPush: vi.fn(),
  sendMobilePush: vi.fn(),
  createNotification: vi.fn(),
  resolveAgentDisplayName: vi.fn(),
  resolveNotificationChannels: vi.fn(),
  agentNotifiesNotion: vi.fn(),
}))

vi.mock('./notion', () => ({ notifyNotionInbox }))
vi.mock('./web-push', () => ({ sendBrowserPush }))
vi.mock('./mobile-push', () => ({ sendMobilePush }))
vi.mock('./notification-store', () => ({ createNotification }))
vi.mock('./abc-agents', () => ({
  agentNotifiesNotion,
  HUGO_AGENT_ID: '01_Hugo_orchestrator',
}))
vi.mock('@ak-system/api', () => ({ resolveAgentDisplayName, resolveNotificationChannels }))

import { notifyAgentRunComplete } from './agent-notifications'

const RUN = {
  agentId: '04_meeting_prep_herald',
  summary: 'Prep for the 15:00 meeting',
  channel: 'cron' as const,
}

describe('notifyAgentRunComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NOTION_API_KEY = 'test-key'
    agentNotifiesNotion.mockReturnValue(true)
    resolveAgentDisplayName.mockResolvedValue('Meeting Prep Herald')
    resolveNotificationChannels.mockResolvedValue({ push: true })
    notifyNotionInbox.mockResolvedValue(undefined)
    createNotification.mockResolvedValue(undefined)
    sendBrowserPush.mockResolvedValue(1)
    sendMobilePush.mockResolvedValue(1)
  })

  it('delivers the push when it owns the notification', async () => {
    const result = await notifyAgentRunComplete(RUN)

    expect(sendBrowserPush).toHaveBeenCalled()
    expect(sendMobilePush).toHaveBeenCalled()
    expect(createNotification).toHaveBeenCalled()
    expect(result.webPush).toBe(1)
  })

  it('sends nothing when the caller already pushed this run', async () => {
    const result = await notifyAgentRunComplete({ ...RUN, push: false })

    expect(sendBrowserPush).not.toHaveBeenCalled()
    expect(sendMobilePush).not.toHaveBeenCalled()
    expect(createNotification).not.toHaveBeenCalled()
    expect(result).toEqual({ notion: true, webPush: 0, fcmPush: 0 })
  })

  it('still archives to Notion when the push is suppressed', async () => {
    await notifyAgentRunComplete({ ...RUN, push: false })

    expect(notifyNotionInbox).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: RUN.agentId, body: RUN.summary }),
    )
  })
})
