/**
 * The harness picture every Chief-of-Staff run starts with (spec: harness-world-state-header).
 * One read of the top open insights plus the last-run stamps, rendered as a short Hebrew block.
 */
import { getDb } from '@ak-system/database'
import { listOpenInsights, type StoredInsight } from './harness-reasoner'
import { readHarnessStamps } from './harness-stamps'

type Db = ReturnType<typeof getDb>

export const HEADER_CHAR_CAP = 1500
export const HEADER_INSIGHTS = 5
export const STALE_REASON_HOURS = 8

const SEVERITY_RANK: Record<string, number> = { urgent: 2, attention: 1, info: 0 }

function minutesAgo(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const ms = now.getTime() - new Date(iso).getTime()
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60000)) : null
}

function agoLabel(mins: number | null): string {
  if (mins === null) return 'לא ידוע'
  if (mins < 60) return `לפני ${mins} דק׳`
  const hours = Math.round(mins / 60)
  return hours < 48 ? `לפני ${hours} שעות` : `לפני ${Math.round(hours / 24)} ימים`
}

/** Pure renderer — exported for tests. Returns '' when the harness has never run. */
export function renderHarnessHeader(
  input: { insights: StoredInsight[]; indexedAt: string | null; reasonedAt: string | null },
  now = new Date(),
): string {
  const { indexedAt, reasonedAt } = input
  if (!reasonedAt && !indexedAt && input.insights.length === 0) return ''
  const top = [...input.insights]
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) || b.score - a.score)
    .slice(0, HEADER_INSIGHTS)

  const reasonMins = minutesAgo(reasonedAt, now)
  const lines: string[] = [
    '## תמונת מצב (harness)',
    `אינדקס עודכן ${agoLabel(minutesAgo(indexedAt, now))} · תובנות עודכנו ${agoLabel(reasonMins)}.`,
  ]
  if (reasonMins === null || reasonMins > STALE_REASON_HOURS * 60) {
    lines.push('⚠️ התמונה ישנה — קרא ל-get_harness_insights לפני שאתה נשען עליה.')
  }
  if (top.length === 0) {
    lines.push('אין תובנות פתוחות.')
  } else {
    lines.push(
      'Open cross-domain insights (treat them exactly like get_harness_insights results: raise the relevant ones under `קישורים בין תחומים:` and cite basedOn):',
    )
  }
  let text = lines.join('\n')
  for (const i of top) {
    const basedOn = i.sources.map((s) => s.label).filter(Boolean).slice(0, 3).join(', ')
    const body = i.body.split('\n')[0].slice(0, 160)
    const line = `- [${i.severity}] ${i.title} — ${body}${basedOn ? ` (basedOn: ${basedOn})` : ''}`
    if (text.length + line.length + 1 > HEADER_CHAR_CAP) break
    text += `\n${line}`
  }
  return text
}

export async function buildHarnessHeader(db?: Db, now = new Date()): Promise<string> {
  try {
    db = db ?? getDb()
    const [stamps, insights] = await Promise.all([
      readHarnessStamps(db),
      listOpenInsights(db, { limit: 20, now }),
    ])
    return renderHarnessHeader({ insights, ...stamps }, now)
  } catch (err) {
    console.warn('[harness-header] failed, omitting block', err)
    return ''
  }
}
