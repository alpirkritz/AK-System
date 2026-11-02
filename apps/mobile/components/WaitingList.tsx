import { useRouter, type Href } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { useAuth } from '../lib/auth'
import { completeWaiting, type MobileWaitingBuckets, type MobileWaitingItem } from '../lib/data'
import { colors } from '../lib/theme'
import {
  WAITING_SECTIONS, dueLabel, dueNow, groupByPerson, groupByPersonUrgentFirst, waitingSourceName,
  type WaitingView,
} from '../lib/waiting'

type RowProps = {
  item: MobileWaitingItem
  showPerson?: boolean
  overdue?: boolean
  /** Called after the item was closed, so the screen can drop it. */
  onDone: (item: MobileWaitingItem) => void
}

/** What first, then who, when and where from. A circle on the left closes it. */
export function WaitingRow({ item, showPerson = true, overdue = false, onDone }: RowProps) {
  const { token } = useAuth()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const close = async () => {
    if (!token) return
    setBusy(true)
    try {
      await completeWaiting(token, item.kind, item.id)
      onDone(item)
    } catch (err) {
      Alert.alert('שגיאה', err instanceof Error ? err.message : 'הפעולה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  const meta = [
    showPerson ? item.personName : null,
    item.dueDate ? dueLabel(item.dueDate) : null,
    `${waitingSourceName(item.source)}${item.sourceLabel ? ` · ${item.sourceLabel}` : ''}`,
  ].filter(Boolean)

  return (
    <View style={styles.row}>
      <Pressable
        style={styles.body}
        accessibilityRole="button"
        onPress={() => {
          if (item.kind === 'task') router.push(`/task/${item.id}` as Href)
          else if (item.meetingId) router.push(`/meeting/${item.meetingId}` as Href)
        }}
      >
        <Text style={styles.title}>{item.title}</Text>
        <Text style={[styles.meta, overdue && styles.metaOverdue]}>
          {overdue ? 'באיחור · ' : ''}
          {meta.join(' · ')}
        </Text>
      </Pressable>
      <Pressable
        onPress={close}
        disabled={busy}
        style={styles.check}
        accessibilityRole="button"
        accessibilityLabel={`סמן כבוצע: ${item.title}`}
      >
        <Text style={styles.checkIcon}>{busy ? '…' : '○'}</Text>
      </Pressable>
    </View>
  )
}

type Props = {
  buckets: MobileWaitingBuckets
  view: WaitingView
  showPerson?: boolean
  onDone: (item: MobileWaitingItem) => void
}

function PersonBlocks({
  groups, overdueIds, onDone,
}: { groups: ReturnType<typeof groupByPerson>; overdueIds: Set<string>; onDone: RowProps['onDone'] }) {
  const router = useRouter()
  return (
    <View style={styles.blocks}>
      {groups.map((g) => (
        <View key={g.personId} style={styles.block}>
          <Pressable onPress={() => router.push(`/person/${g.personId}` as Href)} accessibilityRole="link">
            <Text style={styles.person}>{g.personName}</Text>
          </Pressable>
          {g.items.map((i) => (
            <WaitingRow key={`${i.kind}-${i.id}`} item={i} showPerson={false} overdue={overdueIds.has(i.id)} onDone={onDone} />
          ))}
        </View>
      ))}
    </View>
  )
}

/** One list, three shapes: today (late + due, by person), by person, or by time. */
export function WaitingListView({ buckets, view, showPerson = true, onDone }: Props) {
  const overdueIds = new Set(buckets.overdue.map((i) => i.id))
  if (view === 'today') {
    return <PersonBlocks groups={groupByPerson(dueNow(buckets))} overdueIds={overdueIds} onDone={onDone} />
  }
  if (view === 'person') {
    return <PersonBlocks groups={groupByPersonUrgentFirst(buckets)} overdueIds={overdueIds} onDone={onDone} />
  }
  return (
    <View style={styles.blocks}>
      {WAITING_SECTIONS.filter((s) => buckets[s.key].length > 0).map((s) => (
        <View key={s.key} style={styles.block}>
          <Text
            style={[
              styles.section,
              s.tone === 'danger' && { color: colors.error },
              s.tone === 'warn' && { color: colors.warning },
            ]}
          >
            {s.label}
          </Text>
          {buckets[s.key].map((i) => (
            <WaitingRow key={`${i.kind}-${i.id}`} item={i} showPerson={showPerson} overdue={s.key === 'overdue'} onDone={onDone} />
          ))}
        </View>
      ))}
    </View>
  )
}

/** Removes a closed item from every bucket. */
export function withoutItem(b: MobileWaitingBuckets, item: MobileWaitingItem): MobileWaitingBuckets {
  const keep = (list: MobileWaitingItem[]) => list.filter((i) => !(i.kind === item.kind && i.id === item.id))
  return {
    overdue: keep(b.overdue), today: keep(b.today), thisWeek: keep(b.thisWeek), later: keep(b.later), noDate: keep(b.noDate),
  }
}

const styles = StyleSheet.create({
  blocks: { gap: 14 },
  block: { gap: 2 },
  person: { color: colors.textMuted, fontSize: 13, fontWeight: '700', textAlign: 'right', writingDirection: 'rtl', marginBottom: 2 },
  section: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textAlign: 'right', writingDirection: 'rtl' },
  row: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10, paddingVertical: 6 },
  body: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: 15, textAlign: 'right', writingDirection: 'rtl' },
  meta: { color: colors.textMuted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl' },
  metaOverdue: { color: colors.error },
  check: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  checkIcon: { color: colors.accent, fontSize: 22 },
})
