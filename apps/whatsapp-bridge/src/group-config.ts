import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import pino from 'pino'
import { config } from './config.js'
import { configFilePath, resolveConfigFileForRead } from './config-store.js'

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

const GROUP_CONFIG_FILE = 'group-config.json'

/** Persist watch config outside the auth state so it survives restarts and session resets. */
function persistPath(): string {
  return configFilePath(GROUP_CONFIG_FILE)
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
    const file = resolveConfigFileForRead(GROUP_CONFIG_FILE)
    if (!existsSync(file)) {
      logger.warn(
        { file, envWatchList: config.watchGroupJids.size },
        'No group watch config on disk — only WATCH_GROUP_JIDS groups will be captured',
      )
      return
    }
    const raw = readFileSync(file, 'utf8')
    const groups = JSON.parse(raw) as GroupRule[]
    if (!Array.isArray(groups)) return
    dynamicGroups = new Map(groups.map((g) => [g.jid, g]))
    useDynamicConfig = true
    const enabled = groups.filter((g) => g.enabled).length
    if (enabled === 0) {
      logger.warn({ file, count: groups.length }, 'No enabled watched groups — no group message will be captured')
    } else {
      logger.info({ count: groups.length, enabled }, 'Restored persisted group config')
    }
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
