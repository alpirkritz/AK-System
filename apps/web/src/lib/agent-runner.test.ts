import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runGeminiAgentChat, notifyAgentRunComplete } = vi.hoisted(() => ({
  runGeminiAgentChat: vi.fn(),
  notifyAgentRunComplete: vi.fn(),
}))

vi.mock('./gemini-agent-engine', () => ({ runGeminiAgentChat }))
vi.mock('./agent-notifications', () => ({ notifyAgentRunComplete }))

import { runAgentForUser } from './agent-runner'

describe('runAgentForUser completion push', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runGeminiAgentChat.mockResolvedValue({ text: 'done' })
    notifyAgentRunComplete.mockResolvedValue({ notion: false, webPush: 0, fcmPush: 0 })
  })

  it('pushes by default so chat and messaging channels still notify', async () => {
    await runAgentForUser({ agentId: '03_morning_briefing', message: 'run', channel: 'web' })

    expect(notifyAgentRunComplete).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: '03_morning_briefing', push: true }),
    )
  })

  it('stays silent when the caller sends its own push', async () => {
    await runAgentForUser({
      agentId: '04_meeting_prep_herald',
      message: 'run',
      channel: 'cron',
      notifyOnComplete: false,
    })

    expect(notifyAgentRunComplete).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: '04_meeting_prep_herald', push: false }),
    )
  })
})
