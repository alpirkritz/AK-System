import { beforeEach, describe, expect, it, vi } from 'vitest'

const { store } = vi.hoisted(() => ({
  store: {
    runs: [] as Array<{ agentId: string; channel: string; notifyOnComplete?: boolean; history: unknown[] }>,
    notifies: [] as Array<{ agentId: string; push?: boolean }>,
    saved: [] as Array<{ agentId: string; role: string; content: string }>,
    history: [] as Array<{ role: string; content: string }>,
  },
}))

vi.mock('./gemini-agent-engine', () => ({
  runGeminiAgentChat: vi.fn(async (opts: { agentId: string; channel: string; history?: unknown[] }) => {
    store.runs.push({
      agentId: opts.agentId,
      channel: opts.channel,
      history: opts.history ?? [],
      notifyOnComplete: undefined,
    })
    return { text: 'תשובה מהוגו' }
  }),
}))
vi.mock('./agent-notifications', () => ({
  notifyAgentRunComplete: vi.fn(async (opts: { agentId: string; push?: boolean }) => {
    store.notifies.push(opts)
    return { notion: false, webPush: 0, fcmPush: 0 }
  }),
}))
vi.mock('./abc-agents', () => ({ HUGO_AGENT_ID: '01_Hugo_orchestrator' }))
vi.mock('./agent-chat-store', () => ({
  getAgentHistory: vi.fn(async () => store.history),
  saveAgentMessage: vi.fn(async (agentId: string, role: string, content: string) => {
    store.saved.push({ agentId, role, content })
  }),
}))

import { runHugoConversation } from './agent-runner'

describe('runHugoConversation', () => {
  beforeEach(() => {
    store.runs = []
    store.notifies = []
    store.saved = []
    store.history = []
  })

  it('routes the conversation to Hugo, not a nameless general assistant', async () => {
    const result = await runHugoConversation({ message: 'מה חשוב עכשיו?', channel: 'web' })

    expect(result.text).toBe('תשובה מהוגו')
    expect(store.runs).toHaveLength(1)
    expect(store.runs[0].agentId).toBe('01_Hugo_orchestrator')
  })

  it('preserves the calling channel, which the agent instruction branches on', async () => {
    await runHugoConversation({ message: 'שלום', channel: 'telegram' })
    expect(store.runs[0].channel).toBe('telegram')
  })

  it('suppresses the push for interactive surfaces so the user is not notified of a reply on screen', async () => {
    await runHugoConversation({ message: 'שלום', channel: 'web', notifyOnComplete: false })
    expect(store.notifies[0].push).toBe(false)
  })

  it('still pushes when the caller does not deliver the reply itself', async () => {
    await runHugoConversation({ message: 'שלום', channel: 'cron' })
    expect(store.notifies[0].push).toBe(true)
  })

  it('writes both turns into the one Hugo thread so context crosses channels', async () => {
    await runHugoConversation({ message: 'שאלה מהאפליקציה', channel: 'web' })

    expect(store.saved).toEqual([
      { agentId: '01_Hugo_orchestrator', role: 'user', content: 'שאלה מהאפליקציה' },
      { agentId: '01_Hugo_orchestrator', role: 'assistant', content: 'תשובה מהוגו' },
    ])
  })

  it('replays the shared thread as context, including turns that arrived on another channel', async () => {
    store.history = [
      { role: 'user', content: 'דיברתי איתך בוואטסאפ על טובית' },
      { role: 'assistant', content: 'כן, יש התכתבות פתוחה' },
      { role: 'system', content: 'should be filtered out' },
    ]

    await runHugoConversation({ message: 'מה היה שם?', channel: 'web' })

    expect(store.runs[0].history).toEqual([
      { role: 'user', content: 'דיברתי איתך בוואטסאפ על טובית' },
      { role: 'assistant', content: 'כן, יש התכתבות פתוחה' },
    ])
  })

  it('sends the user turn before the run, so a failed run still records what was asked', async () => {
    await runHugoConversation({ message: 'שאלה', channel: 'web' })
    expect(store.saved[0].role).toBe('user')
  })
})
