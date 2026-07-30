import fs from 'fs'
import path from 'path'

export interface AgentSummary {
  id: string
  name: string
  role: string
}

/** Primary orchestrator — default voice on WhatsApp and mobile channels. */
export const HUGO_AGENT_ID = '01_Hugo_orchestrator'

export const AGENT_ALIASES: Record<string, string> = {
  hugo: '01_Hugo_orchestrator',
  orchestrator: '01_Hugo_orchestrator',
  הוגו: '01_Hugo_orchestrator',
  אורקסטרטור: '01_Hugo_orchestrator',
  trainer: '02_agent_trainer',
  מאמן: '02_agent_trainer',
  'מאמן סוכנים': '02_agent_trainer',
  morning: '03_morning_briefing',
  brief: '03_morning_briefing',
  briefing: '03_morning_briefing',
  בוקר: '03_morning_briefing',
  תדריך: '03_morning_briefing',
  'תדריך בוקר': '03_morning_briefing',
  'סיכום בוקר': '03_morning_briefing',
  meeting: '04_meeting_prep_herald',
  herald: '04_meeting_prep_herald',
  prep: '04_meeting_prep_herald',
  פגישה: '04_meeting_prep_herald',
  הכנה: '04_meeting_prep_herald',
  'הכנה לפגישה': '04_meeting_prep_herald',
  'meeting prep': '04_meeting_prep_herald',
  ibkr: '05_ibkr_daily_import',
  מסחר: '05_ibkr_daily_import',
  עסקאות: '05_ibkr_daily_import',
  calendar: '06_calendar_optimizer',
  optimizer: '06_calendar_optimizer',
  'calendar optimizer': '06_calendar_optimizer',
  יומן: '06_calendar_optimizer',
  לוח: '06_calendar_optimizer',
  יועץ: '06_calendar_optimizer',
  'יועץ יומן': '06_calendar_optimizer',
  'יועץ-יומן': '06_calendar_optimizer',
  אופטי: '06_calendar_optimizer',
  opti: '06_calendar_optimizer',
  email: '07_email_assistant',
  מייל: '07_email_assistant',
  דואר: '07_email_assistant',
  'עוזר מייל': '07_email_assistant',
  'עוזר-מייל': '07_email_assistant',
  coo: '08_startup_coo',
  startup: '08_startup_coo',
  סטארטאפ: '08_startup_coo',
  תפעול: '08_startup_coo',
  'startup coo': '08_startup_coo',
}

/** Agents that benefit from live Notion context in prompts. */
const NOTION_CONTEXT_AGENTS = new Set([
  HUGO_AGENT_ID,
  '03_morning_briefing',
  '04_meeting_prep_herald',
  '05_ibkr_daily_import',
  '06_calendar_optimizer',
  '07_email_assistant',
  '08_startup_coo',
])

/** Agents that receive pre-fetched Google Calendar events in the system prompt. */
const CALENDAR_CONTEXT_AGENTS = new Set([
  '03_morning_briefing',
  '04_meeting_prep_herald',
  '06_calendar_optimizer',
  '07_email_assistant',
])

/** Agents whose runs are archived to Notion Inbox (orchestrator excluded — routing only). */
const NOTION_NOTIFY_AGENTS = new Set([
  '02_agent_trainer',
  '03_morning_briefing',
  '04_meeting_prep_herald',
  '05_ibkr_daily_import',
  '06_calendar_optimizer',
  '07_email_assistant',
  '08_startup_coo',
])

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

function skillsDir(): string {
  return path.join(getAbcRoot(), 'S_Skills')
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
  const filePath = resolveAgentFilePath(agentId)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Agent not found: ${agentId}`)
  }
  return fs.readFileSync(filePath, 'utf-8')
}

function resolveAgentFilePath(agentId: string): string {
  const safeId = path.basename(agentId)
  if (!safeId || safeId !== agentId || safeId.includes('..')) {
    throw new Error(`Invalid agent id: ${agentId}`)
  }
  return path.join(agentsDir(), `${safeId}.md`)
}

export function saveAgentInstructions(agentId: string, content: string): void {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Agent content cannot be empty')
  }

  const filePath = resolveAgentFilePath(agentId)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Agent not found: ${agentId}`)
  }

  const resolved = path.resolve(filePath)
  const resolvedDir = path.resolve(agentsDir())
  if (!resolved.startsWith(resolvedDir + path.sep)) {
    throw new Error(`Invalid agent path: ${agentId}`)
  }

  fs.writeFileSync(filePath, content, 'utf-8')
}

export function getAbcRootPath(): string {
  return getAbcRoot()
}

export function agentNeedsNotionContext(agentId: string): boolean {
  return NOTION_CONTEXT_AGENTS.has(agentId)
}

export function agentNeedsCalendarContext(agentId: string): boolean {
  return CALENDAR_CONTEXT_AGENTS.has(agentId)
}

/** All registered ABC agent IDs — used for run_abc_agent tool enum. */
export function getRunnableAgentIds(): string[] {
  return listAgents().map((a) => a.id)
}

/** Linked workflow filename for an agent (e.g. `wf_meeting_prep.md`), or null. */
export function getAgentWorkflowFile(agentId: string): string | null {
  return AGENT_WORKFLOWS[agentId] ?? null
}

function resolveWorkflowFilePath(agentId: string): string {
  const wfFile = getAgentWorkflowFile(agentId)
  if (!wfFile) {
    throw new Error(`No workflow mapped for agent: ${agentId}`)
  }
  const safeName = path.basename(wfFile)
  if (!safeName || safeName !== wfFile || safeName.includes('..') || !safeName.endsWith('.md')) {
    throw new Error(`Invalid workflow file: ${wfFile}`)
  }
  return path.join(skillsDir(), safeName)
}

export function getAgentWorkflowContent(agentId: string): string | null {
  const wfFile = getAgentWorkflowFile(agentId)
  if (!wfFile) return null
  const filePath = resolveWorkflowFilePath(agentId)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
}

export function saveAgentWorkflowContent(agentId: string, content: string): void {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Workflow content cannot be empty')
  }

  const filePath = resolveWorkflowFilePath(agentId)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Workflow file not found for agent: ${agentId}`)
  }

  const resolved = path.resolve(filePath)
  const resolvedDir = path.resolve(skillsDir())
  if (!resolved.startsWith(resolvedDir + path.sep)) {
    throw new Error(`Invalid workflow path for agent: ${agentId}`)
  }

  fs.writeFileSync(filePath, content, 'utf-8')
}

export function getAgentEngine(): 'gemini' | 'cursor' {
  const explicit = process.env.AGENT_ENGINE?.toLowerCase()
  if (explicit === 'cursor') return 'cursor'
  if (explicit === 'gemini') return 'gemini'
  if (process.env.GEMINI_API_KEY) return 'gemini'
  return 'cursor'
}

export function resolveAgentId(input: string, extraAliases?: Record<string, string>): string | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null

  if (extraAliases?.[trimmed]) return extraAliases[trimmed]

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

export function agentNotifiesNotion(agentId: string): boolean {
  return NOTION_NOTIFY_AGENTS.has(agentId)
}

export function getAgentDisplayName(agentId: string): string {
  try {
    const content = getAgentInstructions(agentId)
    const nameMatch = content.match(/^#\s+(.+)$/m)
    return nameMatch?.[1]?.trim() ?? agentId
  } catch {
    return agentId
  }
}

export function getDefaultTriggerMessage(agentId: string): string {
  const messages: Record<string, string> = {
    '03_morning_briefing': 'הרץ תדריך בוקר יומי לפי ה-workflow',
    '04_meeting_prep_herald':
      'הכן אותי לפגישה הספציפית בהקשר למטה בלבד. פלט קצר בסגנון Notion: כותרת, על מה לדבר, עמדה מומלצת, משימות קשורות. אל תעתיק את תיאור האירוע מהיומן.',
    '05_ibkr_daily_import': 'הרץ ייבוא יומי IBKR לפי ה-workflow',
    '06_calendar_optimizer': 'הרץ אופטימיזציית יומן יומית לפי ה-workflow',
    '07_email_assistant': 'הרץ עוזר מייל יומי לפי ה-workflow',
    '08_startup_coo': 'הרץ לפי בקשת המייסד — נתח את הבעיה והצע תוכנית',
    '02_agent_trainer': 'הרץ סקירת אימון סוכנים לפי ה-workflow',
    '01_Hugo_orchestrator': 'סכם מצב המערכת והמלץ על פעולות',
  }
  return messages[agentId] ?? 'הרץ workflow לפי ההוראות'
}

function resolveAgentPhrase(
  text: string,
  extraAliases?: Record<string, string>,
): { agentId: string; remainder: string } | null {
  const lower = text.trim().toLowerCase()
  if (!lower) return null

  const aliasEntries = Object.entries({ ...AGENT_ALIASES, ...extraAliases }).sort(
    (a, b) => b[0].length - a[0].length,
  )
  for (const [alias, id] of aliasEntries) {
    const aliasLower = alias.toLowerCase()
    if (lower === aliasLower || lower.startsWith(`${aliasLower} `) || lower.startsWith(`${aliasLower}-`)) {
      const remainder = text.trim().slice(alias.length).trim()
      return { agentId: id, remainder }
    }
  }

  for (const agent of listAgents()) {
    const nameLower = agent.name.toLowerCase()
    if (lower.startsWith(nameLower)) {
      return { agentId: agent.id, remainder: text.trim().slice(agent.name.length).trim() }
    }
    if (lower.startsWith(agent.id.toLowerCase())) {
      return { agentId: agent.id, remainder: text.trim().slice(agent.id.length).trim() }
    }
  }

  const direct = resolveAgentId(lower.split(/\s+/)[0] ?? '', extraAliases)
  if (direct) {
    const firstWord = lower.split(/\s+/)[0] ?? ''
    return { agentId: direct, remainder: text.trim().slice(firstWord.length).trim() }
  }

  return null
}

const RUN_AGENT_PREFIX = /^(?:תר(?:יץ|וץ)|הפעל|run)\s+(?:את\s+(?:ה)?)?/iu
const DEFAULT_RUN_MESSAGE = 'תרוץ — בצע את ה-workflow היומי שלך לפי הוראות הסוכן'

export function parseAgentCommand(
  text: string,
  extraAliases?: Record<string, string>,
): { agentId: string; message: string } | null {
  const trimmed = text.trim()

  if (/^\/(?:agents|סוכנים)\s*$/i.test(trimmed)) {
    return { agentId: '__list__', message: '' }
  }

  const slashMatch = trimmed.match(/^\/(?:agent|סוכן)\s+(\S+)\s+(.*)$/is)
  if (slashMatch) {
    const agentId = resolveAgentId(slashMatch[1]!, extraAliases)
    const message = slashMatch[2]?.trim()
    if (agentId && message) return { agentId, message }
  }

  const atMatch = trimmed.match(/^@(\S+)\s+(.*)$/is)
  if (atMatch) {
    const agentId = resolveAgentId(atMatch[1]!, extraAliases)
    const message = atMatch[2]?.trim()
    if (agentId && message) return { agentId, message }
  }

  if (RUN_AGENT_PREFIX.test(trimmed)) {
    const rest = trimmed.replace(RUN_AGENT_PREFIX, '').trim()
    const resolved = resolveAgentPhrase(rest, extraAliases)
    if (resolved) {
      const message = resolved.remainder || DEFAULT_RUN_MESSAGE
      return { agentId: resolved.agentId, message }
    }
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
  return [
    '📋 סוכנים זמינים (וואטסאפ = Hugo מדבר איתך ישירות):',
    '',
    ...lines,
    '',
    'בוואטסאפ: פשוט כתוב ל-Hugo (תריץ בוקר, מה יש לי היום, וכו\')',
    'במערכת: /agents או /agent <alias> <שאלה>',
  ].join('\n')
}
