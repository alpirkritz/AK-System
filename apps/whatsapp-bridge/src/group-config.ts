import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import pino from 'pino'
import { config } from './config.js'

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

export interface GroupRule {
  jid: string
  name: string
  enabled: boolean
  fomoEnabled: boolean
  fomoThreshold: number
  fomoWindowMinutes: number
  keywords: string[]
  summaryTimes: string[]
  labelSummaryTimes: string[]
  lastFomoAlertAt: string | null
}

let dynamicGroups = new Map<string, GroupRule>()
let useDynamicConfig = false

/** Persist watch config next to the auth state so it survives bridge restarts. */
function persistPath(): string {
  return join(config.authStatePath, 'group-config.json')
}

function persistGroupConfig(): void {
  try {
    const file = persistPath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify([...dynamicGroups.values()]), 'utf8')
  } catch (err) {
    logger.error({ err }, 'Failed to persist group config')
  }
}

/** Restore watch config on startup so groups keep working after a restart/redeploy. */
export function loadPersistedGroupConfig(): void {
  try {
    const file = persistPath()
    if (!existsSync(file)) return
    const raw = readFileSync(file, 'utf8')
    const groups = JSON.parse(raw) as GroupRule[]
    if (!Array.isArray(groups)) return
    dynamicGroups = new Map(groups.map((g) => [g.jid, g]))
    useDynamicConfig = true
    logger.info({ count: groups.length }, 'Restored persisted group config')
  } catch (err) {
    logger.error({ err }, 'Failed to load persisted group config')
  }
}

export function reloadGroupConfig(groups: GroupRule[]): void {
  dynamicGroups = new Map(groups.map((g) => [g.jid, g]))
  useDynamicConfig = true
  persistGroupConfig()
}

export function getGroupRule(jid: string): GroupRule | undefined {
  return dynamicGroups.get(jid)
}

export function isGroupWatched(jid: string): boolean {
  if (useDynamicConfig) {
    const rule = dynamicGroups.get(jid)
    return rule?.enabled === true
  }
  return config.watchGroupJids.has(jid)
}

export function listEnabledGroupJids(): string[] {
  if (useDynamicConfig) {
    return [...dynamicGroups.values()].filter((g) => g.enabled).map((g) => g.jid)
  }
  return Array.from(config.watchGroupJids)
}

export function listWatchedGroupRules(): GroupRule[] {
  if (useDynamicConfig) {
    return [...dynamicGroups.values()].filter((g) => g.enabled)
  }
  return Array.from(config.watchGroupJids).map((jid) => ({
    jid,
    name: jid,
    enabled: true,
    fomoEnabled: false,
    fomoThreshold: 5,
    fomoWindowMinutes: 5,
    keywords: [],
    summaryTimes: [],
    labelSummaryTimes: [],
    lastFomoAlertAt: null,
  }))
}

export function updateGroupLastFomoAlert(jid: string, iso: string): void {
  const rule = dynamicGroups.get(jid)
  if (rule) {
    rule.lastFomoAlertAt = iso
    persistGroupConfig()
  }
}
