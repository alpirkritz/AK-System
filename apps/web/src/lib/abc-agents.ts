import fs from 'fs'
import path from 'path'

export interface AgentSummary {
  id: string
  name: string
  role: string
}

export const AGENT_ALIASES: Record<string, string> = {
  hugo: '01_Hugo_orchestrator',
  orchestrator: '01_Hugo_orchestrator',
  trainer: '02_agent_trainer',
  morning: '03_morning_briefing',
  brief: '03_morning_briefing',
  briefing: '03_morning_briefing',
  meeting: '04_meeting_prep_herald',
  herald: '04_meeting_prep_herald',
  prep: '04_meeting_prep_herald',
  ibkr: '05_ibkr_daily_import',
  calendar: '06_calendar_optimizer',
  optimizer: '06_calendar_optimizer',
  email: '07_email_assistant',
  coo: '08_startup_coo',
  startup: '08_startup_coo',
}

const AGENT_WORKFLOWS: Record<string, string> = {
  '03_morning_briefing': 'wf_morning_brief.md',
  '04_meeting_prep_herald': 'wf_meeting_prep.md',
  '05_ibkr_daily_import': 'wf_ibkr_daily_import.md',
  '06_calendar_optimizer': 'wf_calendar_optimizer.md',
  '07_email_assistant': 'wf_email_assistant.md',
  '08_startup_coo': 'wf_startup_coo.md',
}

function getAbcRoot(): string {
  const configured = process.env.ABC_ROOT
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
  }
  return path.resolve(process.cwd(), '../..')
}

function agentsDir(): string {
  return path.join(getAbcRoot(), 'A_Agents')
}

export function listAgents(): AgentSummary[] {
  const dir = agentsDir()
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((filename) => {
      const id = filename.replace(/\.md$/, '')
      const content = fs.readFileSync(path.join(dir, filename), 'utf-8')
      const nameMatch = content.match(/^#\s+(.+)$/m)
      const name = nameMatch?.[1]?.trim() ?? id
      const roleMatch = content.match(/\*\*Responsibilities:\*\*\s*\n- (.+)/)
        ?? content.match(/## Role\s*\n\s*\n(.+)/)
      const role = roleMatch?.[1]?.trim().slice(0, 120) ?? ''
      return { id, name, role }
    })
}

export function getAgentInstructions(agentId: string): string {
  const safeId = path.basename(agentId)
  const filePath = path.join(agentsDir(), `${safeId}.md`)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Agent not found: ${agentId}`)
  }
  return fs.readFileSync(filePath, 'utf-8')
}

export function getAbcRootPath(): string {
  return getAbcRoot()
}

export function agentNeedsNotionContext(agentId: string): boolean {
  return (
    agentId.includes('morning_briefing') ||
    agentId.includes('morning-briefing') ||
    agentId.includes('calendar_optimizer')
  )
}

export function getAgentWorkflowContent(agentId: string): string | null {
  const wfFile = AGENT_WORKFLOWS[agentId]
  if (!wfFile) return null
  const filePath = path.join(getAbcRoot(), 'S_Skills', wfFile)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
}

export function getAgentEngine(): 'gemini' | 'cursor' {
  const explicit = process.env.AGENT_ENGINE?.toLowerCase()
  if (explicit === 'cursor') return 'cursor'
  if (explicit === 'gemini') return 'gemini'
  if (process.env.GEMINI_API_KEY) return 'gemini'
  return 'cursor'
}

export function resolveAgentId(input: string): string | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null

  if (AGENT_ALIASES[trimmed]) return AGENT_ALIASES[trimmed]

  const agents = listAgents()
  const exact = agents.find((a) => a.id.toLowerCase() === trimmed)
  if (exact) return exact.id

  const partial = agents.find(
    (a) =>
      a.id.toLowerCase().includes(trimmed) ||
      a.name.toLowerCase().includes(trimmed),
  )
  return partial?.id ?? null
}

export function parseAgentCommand(text: string): { agentId: string; message: string } | null {
  const trimmed = text.trim()

  if (/^\/(?:agents|סוכנים)\s*$/i.test(trimmed)) {
    return { agentId: '__list__', message: '' }
  }

  const slashMatch = trimmed.match(/^\/(?:agent|סוכן)\s+(\S+)\s+(.*)$/is)
  if (slashMatch) {
    const agentId = resolveAgentId(slashMatch[1]!)
    const message = slashMatch[2]?.trim()
    if (agentId && message) return { agentId, message }
  }

  const atMatch = trimmed.match(/^@(\S+)\s+(.*)$/is)
  if (atMatch) {
    const agentId = resolveAgentId(atMatch[1]!)
    const message = atMatch[2]?.trim()
    if (agentId && message) return { agentId, message }
  }

  return null
}

export function formatAgentList(): string {
  const agents = listAgents()
  const lines = agents.map((a) => {
    const aliases = Object.entries(AGENT_ALIASES)
      .filter(([, id]) => id === a.id)
      .map(([alias]) => alias)
      .slice(0, 3)
    const aliasStr = aliases.length > 0 ? ` (${aliases.join(', ')})` : ''
    return `• ${a.name}${aliasStr}\n  /agent ${aliases[0] ?? a.id} <שאלה>`
  })
  return ['📋 סוכנים זמינים:', '', ...lines, '', 'דוגמה: /agent calendar נתח את הלוח שלי היום'].join('\n')
}
