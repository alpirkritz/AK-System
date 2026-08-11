import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SectionHeader } from '../../components/SectionHeader'
import { ToggleRow } from '../../components/ToggleRow'
import { useAuth } from '../../lib/auth'
import { fetchNotificationPrefs, upsertNotificationPref } from '../../lib/data'
import { colors } from '../../lib/theme'

type Channel = 'whatsapp' | 'push' | 'telegram'

type NotificationPrefItem = {
  id: string
  label: string
  description: string
  category: string
  enabled: boolean
  availableChannels: Channel[]
  channels: { whatsapp: boolean; push: boolean; telegram: boolean }
}

const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  push: 'פוש',
  telegram: 'Telegram',
}

const CATEGORY_TITLES: Record<string, string> = {
  cron: 'תדריכי מערכת',
  agent: 'סוכנים',
  whatsapp: 'WhatsApp והוגו',
  hugo: 'WhatsApp והוגו',
}

const CATEGORY_ORDER = ['cron', 'agent', 'whatsapp', 'hugo'] as const

export default function NotificationSettingsScreen() {
  const { token } = useAuth()
  const [items, setItems] = useState<NotificationPrefItem[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const res = (await fetchNotificationPrefs(token)) as { items?: NotificationPrefItem[] }
      setItems(res.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const patchItem = (typeId: string, patch: Partial<NotificationPrefItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === typeId ? { ...item, ...patch } : item)),
    )
  }

  const saveEnabled = async (typeId: string, enabled: boolean) => {
    if (!token) return
    setSavingId(typeId)
    setError(null)
    patchItem(typeId, { enabled })
    try {
      await upsertNotificationPref(token, { typeId, enabled })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שמירה נכשלה')
      void load()
    } finally {
      setSavingId(null)
    }
  }

  const saveChannel = async (typeId: string, ch: Channel, value: boolean) => {
    if (!token) return
    setSavingId(typeId)
    setError(null)
    setItems((prev) =>
      prev.map((item) =>
        item.id === typeId
          ? { ...item, channels: { ...item.channels, [ch]: value } }
          : item,
      ),
    )
    try {
      await upsertNotificationPref(token, { typeId, channels: { [ch]: value } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שמירה נכשלה')
      void load()
    } finally {
      setSavingId(null)
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    title: CATEGORY_TITLES[cat] ?? cat,
    rows: items.filter((i) => i.category === cat),
  })).filter((g) => g.rows.length > 0)

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {grouped.map(({ cat, title, rows }) => (
        <View key={cat}>
          <SectionHeader title={title} style={styles.section} />
          <View style={styles.group}>
            {rows.map((item) => (
              <View key={item.id}>
                <ToggleRow
                  label={item.label}
                  description={item.description}
                  value={item.enabled}
                  disabled={savingId === item.id}
                  onValueChange={(v) => void saveEnabled(item.id, v)}
                />
                {item.enabled &&
                  item.availableChannels.map((ch) => (
                    <ToggleRow
                      key={`${item.id}-${ch}`}
                      label={CHANNEL_LABELS[ch]}
                      value={item.channels[ch]}
                      disabled={savingId === item.id}
                      onValueChange={(v) => void saveChannel(item.id, ch, v)}
                    />
                  ))}
              </View>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  section: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  group: {
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  error: {
    color: colors.error,
    textAlign: 'center',
    padding: 12,
    writingDirection: 'rtl',
  },
})
