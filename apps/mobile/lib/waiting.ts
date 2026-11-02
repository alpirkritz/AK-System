import type { MobileWaitingBuckets, MobileWaitingItem } from './data'

export type WaitingView = 'today' | 'person' | 'time'

export const WAITING_SECTIONS: { key: keyof MobileWaitingBuckets; label: string; tone: 'danger' | 'warn' | 'muted' }[] = [
  { key: 'overdue', label: 'באיחור', tone: 'danger' },
  { key: 'today', label: 'להיום', tone: 'warn' },
  { key: 'thisWeek', label: 'השבוע', tone: 'muted' },
  { key: 'later', label: 'אחר כך', tone: 'muted' },
  { key: 'noDate', label: 'בלי תאריך', tone: 'muted' },
]

export const flattenWaiting = (b: MobileWaitingBuckets): MobileWaitingItem[] =>
  WAITING_SECTIONS.flatMap((s) => b[s.key])

/** Late or due today: the "who owes me what today" set. */
export const dueNow = (b: MobileWaitingBuckets): MobileWaitingItem[] => [...b.overdue, ...b.today]

export function groupByPerson(items: MobileWaitingItem[]): { personId: string; personName: string; items: MobileWaitingItem[] }[] {
  const map = new Map<string, { personId: string; personName: string; items: MobileWaitingItem[] }>()
  for (const item of items) {
    const g = map.get(item.personId) ?? { personId: item.personId, personName: item.personName, items: [] }
    g.items.push(item)
    map.set(item.personId, g)
  }
  return [...map.values()]
}

/** People with something late or due today first, otherwise in the order given. */
export function groupByPersonUrgentFirst(b: MobileWaitingBuckets) {
  const urgent = new Set(dueNow(b).map((i) => i.personId))
  return groupByPerson(flattenWaiting(b)).sort((a, c) => Number(urgent.has(c.personId)) - Number(urgent.has(a.personId)))
}

export function dueLabel(iso: string | null): string {
  if (!iso) return ''
  const [, m, d] = iso.slice(0, 10).split('-')
  return `עד ${Number(d)}.${Number(m)}`
}

const SOURCE_NAMES: Record<string, string> = {
  meeting: 'פגישה', manual: 'ידני', notion: 'Notion', meeting_analysis: 'Notion',
  whatsapp_dm: 'WhatsApp', whatsapp_group: 'WhatsApp', email: 'מייל', voice: 'הקלטה', slack_channel: 'Slack',
}
export const waitingSourceName = (s: string) => SOURCE_NAMES[s] ?? s
