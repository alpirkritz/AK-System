import { config } from './config.js'

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

export function reloadGroupConfig(groups: GroupRule[]): void {
  dynamicGroups = new Map(groups.map((g) => [g.jid, g]))
  useDynamicConfig = true
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
  if (rule) rule.lastFomoAlertAt = iso
}
