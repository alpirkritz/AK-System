import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

let tmpRoot: string

function memoryFile(): string {
  return path.join(tmpRoot, 'M_Memory', 'agents_daily_sync.md')
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feedback-'))
  process.env.ABC_ROOT = tmpRoot
  fs.mkdirSync(path.join(tmpRoot, 'A_Agents'), { recursive: true })
  fs.mkdirSync(path.join(tmpRoot, 'M_Memory'), { recursive: true })
  fs.writeFileSync(
    path.join(tmpRoot, 'A_Agents', '06_calendar_optimizer.md'),
    '# Calendar Optimizer\n\n## Role\n\nOptimize the calendar.\n',
    'utf-8',
  )
  fs.writeFileSync(memoryFile(), '# Agents Daily Sync & Run Log\n\nExisting entry.\n', 'utf-8')
  vi.resetModules()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

async function loadModule() {
  return import('./agent-feedback-log')
}

describe('appendAgentFeedback', () => {
  it('appends an entry without removing existing content', async () => {
    const { appendAgentFeedback } = await loadModule()
    const res = appendAgentFeedback({
      agentId: '06_calendar_optimizer',
      feedback: 'הוא קובע פגישות ב-8 בבוקר, זה מוקדם מדי',
    })

    expect(res.logged).toBe(true)
    expect(res.agentId).toBe('06_calendar_optimizer')
    expect(res.path).toBe(path.join('M_Memory', 'agents_daily_sync.md'))

    const content = fs.readFileSync(memoryFile(), 'utf-8')
    expect(content).toContain('Existing entry.')
    expect(content).toContain('06_calendar_optimizer — User correction (pending review)')
    expect(content).toContain('הוא קובע פגישות ב-8 בבוקר, זה מוקדם מדי')
    expect(content).toContain('**Status:** Blocked')
  })

  it('records the feedback verbatim as a blockquote, preserving line breaks', async () => {
    const { appendAgentFeedback } = await loadModule()
    appendAgentFeedback({
      agentId: '06_calendar_optimizer',
      feedback: 'שורה ראשונה\nשורה שנייה',
    })

    const content = fs.readFileSync(memoryFile(), 'utf-8')
    expect(content).toContain('> שורה ראשונה\n> שורה שנייה')
  })

  it('notes that the agent card was not edited, and leaves it untouched', async () => {
    const { appendAgentFeedback } = await loadModule()
    const agentCard = path.join(tmpRoot, 'A_Agents', '06_calendar_optimizer.md')
    const before = fs.readFileSync(agentCard, 'utf-8')

    appendAgentFeedback({ agentId: '06_calendar_optimizer', feedback: 'תיקון' })

    expect(fs.readFileSync(agentCard, 'utf-8')).toBe(before)
    expect(fs.readFileSync(memoryFile(), 'utf-8')).toContain(
      '`A_Agents/06_calendar_optimizer.md` NOT edited automatically',
    )
  })

  it('includes the channel when provided', async () => {
    const { appendAgentFeedback } = await loadModule()
    appendAgentFeedback({
      agentId: '06_calendar_optimizer',
      feedback: 'תיקון',
      channel: 'whatsapp',
    })
    expect(fs.readFileSync(memoryFile(), 'utf-8')).toContain('(whatsapp)')
  })

  it('appends twice without overwriting the first entry', async () => {
    const { appendAgentFeedback } = await loadModule()
    appendAgentFeedback({ agentId: '06_calendar_optimizer', feedback: 'תיקון ראשון' })
    appendAgentFeedback({ agentId: '06_calendar_optimizer', feedback: 'תיקון שני' })

    const content = fs.readFileSync(memoryFile(), 'utf-8')
    expect(content).toContain('תיקון ראשון')
    expect(content).toContain('תיקון שני')
  })

  it('rejects a path-traversal agent id', async () => {
    const { appendAgentFeedback } = await loadModule()
    expect(() =>
      appendAgentFeedback({ agentId: '../../etc/passwd', feedback: 'x' }),
    ).toThrow(/Invalid agent id/i)
  })

  it('rejects empty feedback', async () => {
    const { appendAgentFeedback } = await loadModule()
    expect(() =>
      appendAgentFeedback({ agentId: '06_calendar_optimizer', feedback: '   ' }),
    ).toThrow(/feedback is required/i)
  })

  it('creates M_Memory if it does not exist yet', async () => {
    fs.rmSync(path.join(tmpRoot, 'M_Memory'), { recursive: true, force: true })
    const { appendAgentFeedback } = await loadModule()

    appendAgentFeedback({ agentId: '06_calendar_optimizer', feedback: 'תיקון' })
    expect(fs.readFileSync(memoryFile(), 'utf-8')).toContain('תיקון')
  })
})
