import pino from 'pino'
import { config } from './config.js'
import {
  getGroupRule,
  updateGroupLastFomoAlert,
  type GroupRule,
} from './group-config.js'
import { getGroupBuffer, type BufferedGroupMessage } from './group-buffer.js'

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

const FOMO_COOLDOWN_MS = 15 * 60 * 1000
const fomoWindows = new Map<string, number[]>()
const keywordCooldown = new Map<string, number>()
const KEYWORD_COOLDOWN_MS = 5 * 60 * 1000

function resolveGroupAlertUrl(): string {
  if (process.env.AK_GROUP_ALERT_URL) return process.env.AK_GROUP_ALERT_URL
  if (!config.akWebhookUrl) return ''
  return config.akWebhookUrl.replace(/\/webhook\/?$/, '/group-alert')
}

async function postGroupAlert(payload: {
  type: 'fomo' | 'keyword'
  groupJid: string
  groupName: string
  snippet: string
  match?: string
  count?: number
  messages?: BufferedGroupMessage[]
}): Promise<void> {
  const url = resolveGroupAlertUrl()
  if (!url) {
    logger.warn('AK group-alert URL not configured')
    return
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.bridgeSecret}`,
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.text()
      logger.error({ status: res.status, body }, 'Group alert POST failed')
    }
  } catch (err) {
    logger.error({ err }, 'Group alert POST error')
  }
}

function checkFomo(groupJid: string, rule: GroupRule): void {
  if (!rule.fomoEnabled) return

  const now = Date.now()
  const windowMs = rule.fomoWindowMinutes * 60 * 1000
  const timestamps = fomoWindows.get(groupJid) ?? []
  timestamps.push(now)
  const cutoff = now - windowMs
  const inWindow = timestamps.filter((t) => t >= cutoff)
  fomoWindows.set(groupJid, inWindow)

  if (inWindow.length < rule.fomoThreshold) return

  if (rule.lastFomoAlertAt) {
    const last = new Date(rule.lastFomoAlertAt).getTime()
    if (now - last < FOMO_COOLDOWN_MS) return
  }

  updateGroupLastFomoAlert(groupJid, new Date(now).toISOString())
  fomoWindows.set(groupJid, [])

  const recentMessages = getGroupBuffer(groupJid).filter((m) => {
    const ts = m.timestamp < 1e12 ? m.timestamp * 1000 : m.timestamp
    return ts >= cutoff
  })

  void postGroupAlert({
    type: 'fomo',
    groupJid,
    groupName: rule.name,
    snippet: `${recentMessages.length} הודעות ב-${rule.fomoWindowMinutes} דקות`,
    count: recentMessages.length,
    messages: recentMessages,
  })
}

function checkKeywords(groupJid: string, rule: GroupRule, text: string): void {
  if (rule.keywords.length === 0) return
  const lower = text.toLowerCase()
  for (const kw of rule.keywords) {
    const needle = kw.trim().toLowerCase()
    if (!needle || !lower.includes(needle)) continue

    const cooldownKey = `${groupJid}:${needle}`
    const last = keywordCooldown.get(cooldownKey) ?? 0
    if (Date.now() - last < KEYWORD_COOLDOWN_MS) return
    keywordCooldown.set(cooldownKey, Date.now())

    void postGroupAlert({
      type: 'keyword',
      groupJid,
      groupName: rule.name,
      snippet: text.slice(0, 120),
      match: kw,
    })
    break
  }
}

export function onGroupMessage(groupJid: string, text: string): void {
  const rule = getGroupRule(groupJid)
  if (!rule?.enabled) return
  checkFomo(groupJid, rule)
  checkKeywords(groupJid, rule, text)
}
