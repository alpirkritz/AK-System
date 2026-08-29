import fs from 'fs'
import path from 'path'

export interface AgentSummary {
  id: string
  name: string
  role: string
}

/**
 * Suggested schedule times offered in the UI when an agent has none yet.
 * Suggestions only — never auto-enabled, and absence from this map does not
 * stop an agent from being scheduled. Meeting prep is deliberately absent: it
 * is event-driven (15 min before each meeting), not clock-driven.
 */
export const DEFAULT_SCHEDULE_TIMES: Record<string, string[]> = {
  '03_morning_briefing': ['07:00'],
  '05_ibkr_daily_import': ['18:00'],
  '06_calendar_optimizer': ['07:00'],
  '07_email_assistant': ['09:00'],
}

export const DEFAULT_TRIGGER_MESSAGES: Record<string, string> = {
  '03_morning_briefing': 'הרץ תדריך בוקר יומי לפי ה-workflow',
  '04_meeting_prep_herald':
    'הכן אותי לפגישה הספציפית בהקשר למטה בלבד. פלט קצר בסגנון Notion: כותרת, על מה לדבר, עמדה מומלצת, משימות קשורות. אל תעתיק את תיאור האירוע מהיומן.',
  '05_ibkr_daily_import': 'הרץ ייבוא יומי IBKR לפי ה-workflow',
  '06_calendar_optimizer': 'הרץ אופטימיזציית יומן יומית לפי ה-workflow',
  '07_email_assistant': 'הרץ עוזר מייל יומי לפי ה-workflow',
  '08_startup_coo': 'הרץ לפי בקשת המייסד — נתח את הבעיה והצע תוכנית',
  '02_agent_trainer': 'הרץ סקירת אימון סוכנים לפי ה-workflow',
  '01_Hugo_orchestrator': 'סכם מה חשוב עכשיו, למה, ומה הצעד הבא',
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
