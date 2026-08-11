import {
  getSchedulablePreference,
  markNotificationSent,
  wasNotificationSentToday,
} from '@ak-system/api'
import { pushAssistantMessage } from './push-notifications'

/**
 * Daily finance alerting, run from the morning-briefing cron.
 *
 * Deliberately conservative: only `warn` insights, only above a shekel threshold, and at most
 * one push per calendar day. A finding that repeats every morning stops being a signal.
 */

export const FINANCE_ALERT_TYPE_ID = 'finance_insight'

/** Below this, a warning is real but not worth interrupting the day for. */
export const FINANCE_ALERT_MIN_AMOUNT = 1000

const TIMEZONE = process.env.TIMEZONE || 'Asia/Jerusalem'
const MAX_LINES = 3

export interface FinanceAlertInsight {
  kind: string
  severity: string
  title: string
  body: string
  amount: number | null
}

/** Warnings big enough to act on, worst first. */
export function selectFinanceAlerts(
  insights: readonly FinanceAlertInsight[],
  minAmount = FINANCE_ALERT_MIN_AMOUNT
): FinanceAlertInsight[] {
  return insights
    .filter((i) => i.severity === 'warn' && Math.abs(i.amount ?? 0) >= minAmount)
    .sort((a, b) => Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0))
}

/** One line per finding, for the finance section of the morning briefing. */
export function formatFinanceBriefLines(insights: readonly FinanceAlertInsight[]): string[] {
  return selectFinanceAlerts(insights)
    .slice(0, MAX_LINES)
    .map((i) => `• ${i.title}`)
}

/**
 * Push the top finding, unless one already went out today. Returns what it decided and why,
 * so the cron response stays debuggable without reading the notification table.
 */
export async function maybePushFinanceAlert(
  insights: readonly FinanceAlertInsight[]
): Promise<{ sent: boolean; reason: 'sent' | 'nothing-to-report' | 'already-sent-today' | 'disabled' }> {
  const alerts = selectFinanceAlerts(insights)
  if (alerts.length === 0) return { sent: false, reason: 'nothing-to-report' }

  const pref = await getSchedulablePreference(FINANCE_ALERT_TYPE_ID)
  if (!pref.enabled) return { sent: false, reason: 'disabled' }
  if (wasNotificationSentToday(pref.lastSentAt, TIMEZONE)) {
    return { sent: false, reason: 'already-sent-today' }
  }

  const [top, ...rest] = alerts
  const lines = [`💰 ${top.title}`, '', top.body]
  if (rest.length > 0) {
    lines.push('', 'עוד בתקופה:', ...rest.slice(0, MAX_LINES - 1).map((i) => `• ${i.title}`))
  }

  await pushAssistantMessage(lines.join('\n'), 'cron', {
    typeId: FINANCE_ALERT_TYPE_ID,
    title: top.title,
    url: '/finance?tab=insights',
  })
  await markNotificationSent(FINANCE_ALERT_TYPE_ID)
  return { sent: true, reason: 'sent' }
}
