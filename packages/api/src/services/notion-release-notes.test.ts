import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getDb, notionReleaseSeen } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import {
  composeReleaseMessage,
  renderBlocks,
  runReleaseNotesListener,
  RELEASE_NOTES_MAX_ATTEMPTS,
  type ReleasePage,
} from './notion-release-notes'

const rt = (t: string) => [{ plain_text: t }]

function page(id: string, name: string, created = '2026-11-08T10:00:00.000Z'): ReleasePage {
  return {
    id,
    createdTime: created,
    url: `https://notion.so/${id}`,
    properties: {
      Name: { type: 'title', title: rt(name) },
      Date: { type: 'date', date: { start: '2026-11-08' } },
      Commit: { type: 'url', url: 'https://github.com/x/y/commit/abc' },
      Run: { type: 'url', url: 'https://github.com/x/y/actions/runs/1' },
      Services: { type: 'rich_text', rich_text: rt('api, web') },
      'Schema changes': { type: 'checkbox', checkbox: true },
    },
  }
}

function makeDeps(pages: ReleasePage[], opts: { whatsapp?: boolean; sendOk?: boolean } = {}) {
  const send = vi.fn(async () => (opts.sendOk === false ? { ok: false, error: 'bridge down' } : { ok: true }))
  const state = { pages }
  return {
    state,
    send,
    deps: {
      listPages: async () => state.pages,
      fetchBody: async () => 'גוף ההודעה',
      send,
      channels: async () => ({ enabled: true, whatsapp: opts.whatsapp ?? true }),
      now: () => new Date('2026-11-08T12:00:00.000Z'),
    },
  }
}

describe('notion release notes listener', () => {
  beforeEach(async () => {
    await getDb().delete(notionReleaseSeen)
  })

  it('composes a Hebrew message with every populated field and the body', () => {
    const msg = composeReleaseMessage(page('p1', 'Deploy 42'), '*שינויים*\n• תיקון')
    expect(msg).toContain('*🚀 Release notes — Deploy 42*')
    expect(msg).toContain('📅 08/11/2026')
    expect(msg).toContain('שירותים: api, web')
    expect(msg).toContain('שינויי סכמה: כן')
    expect(msg).toContain('Commit: https://github.com/x/y/commit/abc')
    expect(msg).toContain('Run: https://github.com/x/y/actions/runs/1')
    expect(msg).toContain('• תיקון')
    expect(msg).toContain('https://notion.so/p1')
  })

  it('renders blocks as WhatsApp text', () => {
    const b = (type: string, text: string, extra: Record<string, unknown> = {}) => ({
      block: { id: type, type, [type]: { rich_text: rt(text), ...extra } },
      depth: 0,
    })
    const out = renderBlocks([b('heading_2', 'חדש'), b('bulleted_list_item', 'א'), b('numbered_list_item', 'ב'), b('to_do', 'ג', { checked: true })])
    expect(out).toBe('*חדש*\n• א\n1. ב\n☑ ג')
  })

  it('first run baselines existing records without sending', async () => {
    const { deps, send } = makeDeps([page('a', 'old1'), page('b', 'old2')])
    const res = await runReleaseNotesListener(deps)
    expect(res.baselined).toBe(2)
    expect(res.announcements).toEqual([])
    expect(send).not.toHaveBeenCalled()
  })

  it('baselines even when the database is empty, so the next record is announced', async () => {
    const { deps, send, state } = makeDeps([])
    await runReleaseNotesListener(deps)
    state.pages = [page('new', 'Deploy 1')]
    const res = await runReleaseNotesListener(deps)
    expect(res.announcements).toHaveLength(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('announces a new record exactly once', async () => {
    const { deps, send, state } = makeDeps([page('a', 'old')])
    await runReleaseNotesListener(deps)
    state.pages = [page('a', 'old'), page('b', 'Deploy 2')]
    const first = await runReleaseNotesListener(deps)
    const second = await runReleaseNotesListener(deps)
    expect(first.announcements.map((a) => a.status)).toEqual(['sent'])
    expect(second.announcements).toEqual([])
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('draft mode never calls the bridge and is not re-sent after enabling', async () => {
    const draft = makeDeps([page('a', 'old')], { whatsapp: false })
    await runReleaseNotesListener(draft.deps)
    draft.state.pages = [page('a', 'old'), page('b', 'Deploy 2')]
    const res = await runReleaseNotesListener(draft.deps)
    expect(res.announcements[0].status).toBe('drafted')
    expect(draft.send).not.toHaveBeenCalled()

    const live = makeDeps(draft.state.pages, { whatsapp: true })
    const after = await runReleaseNotesListener(live.deps)
    expect(after.announcements).toEqual([])
    expect(live.send).not.toHaveBeenCalled()
  })

  it('keeps a failed send pending, retries, then marks failed after max attempts', async () => {
    const { deps, send, state } = makeDeps([], { sendOk: false })
    await runReleaseNotesListener(deps)
    state.pages = [page('b', 'Deploy 2')]
    for (let i = 0; i < RELEASE_NOTES_MAX_ATTEMPTS; i++) await runReleaseNotesListener(deps)
    const row = (await getDb().select().from(notionReleaseSeen).where(eq(notionReleaseSeen.pageId, 'b')))[0]
    expect(row.status).toBe('failed')
    expect(row.attempts).toBe(RELEASE_NOTES_MAX_ATTEMPTS)
    expect(send).toHaveBeenCalledTimes(RELEASE_NOTES_MAX_ATTEMPTS)
    await runReleaseNotesListener(deps)
    expect(send).toHaveBeenCalledTimes(RELEASE_NOTES_MAX_ATTEMPTS)
  })

  it('a retry after a transient failure sends once and marks sent', async () => {
    const { deps, send, state } = makeDeps([])
    await runReleaseNotesListener(deps)
    state.pages = [page('b', 'Deploy 2')]
    send.mockResolvedValueOnce({ ok: false, error: 'down' })
    const first = await runReleaseNotesListener(deps)
    const second = await runReleaseNotesListener(deps)
    expect(first.announcements[0].status).toBe('pending')
    expect(second.announcements[0].status).toBe('sent')
  })

  it('reports a Notion failure without touching state', async () => {
    const { deps } = makeDeps([])
    const res = await runReleaseNotesListener({ ...deps, listPages: async () => { throw new Error('Notion 404') } })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('Notion 404')
  })
})
