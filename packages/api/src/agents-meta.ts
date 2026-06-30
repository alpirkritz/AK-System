import fs from 'fs'
import path from 'path'

export interface AgentSummary {
  id: string
  name: string
  role: string
}

/** Agents with daily workflow triggers — schedule UI enabled. */
export const SCHEDULABLE_AGENT_IDS = new Set([
  '03_morning_briefing',
  '04_meeting_prep_herald',
  '05_ibkr_daily_import',
  '06_calendar_optimizer',
  '07_email_assistant',
])

/** Suggested default schedule times (not auto-enabled). */
export const DEFAULT_SCHEDULE_TIMES: Record<string, string[]> = {
  '03_morning_briefing': ['07:00'],
  '04_meeting_prep_herald': ['07:30'],
  '05_ibkr_daily_import': ['18:00'],
  '06_calendar_optimizer': ['08:00'],
  '07_email_assistant': ['09:00'],
}

export const DEFAULT_TRIGGER_MESSAGES: Record<string, string> = {
  '03_morning_briefing': 'הרץ תדריך בוקר יומי לפי ה-workflow',
  '04_meeting_prep_herald': 'הרץ הכנה לפגישות היום לפי ה-workflow',
  '05_ibkr_daily_import': 'הרץ ייבוא יומי IBKR לפי ה-workflow',
  '06_calendar_optimizer': 'הרץ אופטימיזציית יומן יומית לפי ה-workflow',
  '07_email_assistant': 'הרץ עוזר מייל יומי לפי ה-workflow',
  '08_startup_coo': 'הרץ לפי בקשת המייסד — נתח את הבעיה והצע תוכנית',
  '02_agent_trainer': 'הרץ סקירת אימון סוכנים לפי ה-workflow',
  '01_Hugo_orchestrator': 'סכם מצב המערכת והמלץ על פעולות',
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

export function listAgentSummaries(): AgentSummary[] {
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
      const roleMatch =
        content.match(/\*\*Responsibilities:\*\*\s*\n- (.+)/) ??
        content.match(/## Role\s*\n\s*\n(.+)/)
      const role = roleMatch?.[1]?.trim().slice(0, 120) ?? ''
      return { id, name, role }
    })
}

export function isAgentSchedulable(agentId: string): boolean {
  return SCHEDULABLE_AGENT_IDS.has(agentId)
}

export function getDefaultTriggerMessage(agentId: string): string {
  return DEFAULT_TRIGGER_MESSAGES[agentId] ?? 'הרץ workflow לפי ההוראות'
}

export function getDefaultScheduleTimes(agentId: string): string[] {
  return DEFAULT_SCHEDULE_TIMES[agentId] ?? []
}

export function parseJsonTimes(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

export function stringifyJsonTimes(times: string[]): string {
  return JSON.stringify(times)
}
