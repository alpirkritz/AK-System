import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { ListRow } from '../../components/ListRow'
import { SectionHeader } from '../../components/SectionHeader'
import { useAuth } from '../../lib/auth'
import {
  fetchDashboardPrefs,
  setDashboardPrefs,
  type MobileDashboardPrefs,
} from '../../lib/data'
import { colors } from '../../lib/theme'

const MEETING_OPTIONS: Array<{
  value: MobileDashboardPrefs['meetingWindow']
  label: string
}> = [
  { value: 'today', label: 'היום' },
  { value: '3days', label: '3 ימים' },
  { value: 'week', label: 'שבוע' },
]

const TASK_OPTIONS: Array<{
  value: MobileDashboardPrefs['taskWindow']
  label: string
}> = [
  { value: 'today', label: 'היום ובאיחור' },
  { value: 'all', label: 'כל המשימות הפתוחות' },
]

export default function DashboardSettingsScreen() {
  const { token } = useAuth()
  const [prefs, setPrefs] = useState<MobileDashboardPrefs | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      setPrefs(await fetchDashboardPrefs(token))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const saveMeetingWindow = async (meetingWindow: MobileDashboardPrefs['meetingWindow']) => {
    if (!token || !prefs || prefs.meetingWindow === meetingWindow || saving) return
    setSaving(true)
    setError(null)
    try {
      const next = await setDashboardPrefs(token, { meetingWindow })
      setPrefs(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שמירה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  const saveTaskWindow = async (taskWindow: MobileDashboardPrefs['taskWindow']) => {
    if (!token || !prefs || prefs.taskWindow === taskWindow || saving) return
    setSaving(true)
    setError(null)
    try {
      const next = await setDashboardPrefs(token, { taskWindow })
      setPrefs(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שמירה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <View style={styles.flex}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <SectionHeader title="חלון פגישות" style={styles.section} />
      <View style={styles.group}>
        {MEETING_OPTIONS.map((opt) => (
          <ListRow
            key={opt.value}
            label={opt.label}
            value={prefs?.meetingWindow === opt.value ? '✓' : undefined}
            onPress={() => void saveMeetingWindow(opt.value)}
            accessibilityLabel={opt.label}
          />
        ))}
      </View>

      <SectionHeader title="חלון משימות" style={styles.section} />
      <View style={styles.group}>
        {TASK_OPTIONS.map((opt) => (
          <ListRow
            key={opt.value}
            label={opt.label}
            value={prefs?.taskWindow === opt.value ? '✓' : undefined}
            onPress={() => void saveTaskWindow(opt.value)}
            accessibilityLabel={opt.label}
          />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  section: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  group: {
    marginHorizontal: 12,
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
