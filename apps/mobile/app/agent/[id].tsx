import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { FilterChips } from '../../components/FilterChips'
import { FormSheetScaffold } from '../../components/FormSheetScaffold'
import { ToggleRow } from '../../components/ToggleRow'
import { useAuth } from '../../lib/auth'
import {
  fetchAgentConfigs,
  runAgent,
  setAgentDisplayName,
  setAgentEventSubscription,
  setAgentSchedule,
  type MobileAgentConfig,
  type MobileRoutableEvent,
} from '../../lib/data'
import { createTrpcClient } from '../../lib/trpc'
import { colors } from '../../lib/theme'

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

function sortTimes(times: string[]): string[] {
  return [...new Set(times)].sort()
}

function formatLastRun(iso: string | null): string {
  if (!iso) return 'עדיין לא רץ'
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function AgentConfigScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { token } = useAuth()

  const [config, setConfig] = useState<MobileAgentConfig | null>(null)
  const [allAgents, setAllAgents] = useState<MobileAgentConfig[]>([])
  const [events, setEvents] = useState<MobileRoutableEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const [enabled, setEnabled] = useState(false)
  const [times, setTimes] = useState<string[]>([])
  const [subscribedEvents, setSubscribedEvents] = useState<string[]>([])
  const [triggerMessage, setTriggerMessage] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [savedDisplayName, setSavedDisplayName] = useState('')
  const [newTime, setNewTime] = useState('')

  const load = useCallback(async () => {
    if (!token || !id) return
    setLoading(true)
    setError(null)
    try {
      const [res, namesRes] = await Promise.all([
        fetchAgentConfigs(token),
        createTrpcClient(token).settings.agentDisplayNames.get.query() as Promise<{
          rawNames?: Record<string, string>
        }>,
      ])
      const cfg = res.agents.find((a) => a.agentId === id) ?? null
      setConfig(cfg)
      setAllAgents(res.agents)
      setEvents(res.events)
      if (cfg) {
        setEnabled(cfg.enabled)
        setTimes(sortTimes(cfg.scheduleTimes))
        setSubscribedEvents([...cfg.subscribedEvents])
        setTriggerMessage(cfg.triggerMessage ?? '')
      }
      const custom = namesRes.rawNames?.[id] ?? ''
      setDisplayName(custom)
      setSavedDisplayName(custom)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [token, id])

  useEffect(() => {
    void load()
  }, [load])

  const agentNameById = useMemo(
    () => new Map(allAgents.map((a) => [a.agentId, a.name])),
    [allAgents],
  )

  const dirty = useMemo(() => {
    if (!config) return false
    const savedTimes = sortTimes(config.scheduleTimes)
    const savedEvents = [...config.subscribedEvents].sort()
    return (
      enabled !== config.enabled ||
      times.join(',') !== savedTimes.join(',') ||
      subscribedEvents.join(',') !== savedEvents.join(',') ||
      triggerMessage.trim() !== (config.triggerMessage ?? '').trim() ||
      displayName.trim() !== savedDisplayName.trim()
    )
  }, [config, enabled, times, subscribedEvents, triggerMessage, displayName, savedDisplayName])

  const addTime = (raw: string) => {
    const value = raw.trim()
    if (!TIME_PATTERN.test(value)) {
      setError('פורמט שעה: HH:MM (למשל 07:00)')
      return
    }
    if (times.includes(value)) return
    setTimes(sortTimes([...times, value]))
    setNewTime('')
    setError(null)
  }

  const onSave = async () => {
    if (!token || !id || !config || !dirty) return
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      await setAgentSchedule(token, {
        agentId: id,
        enabled: times.length > 0 ? enabled : false,
        scheduleTimes: times,
        triggerMessage: triggerMessage.trim() || null,
      })

      const savedEvents = [...config.subscribedEvents]
      for (const ev of events) {
        const before = savedEvents.includes(ev.typeId)
        const after = subscribedEvents.includes(ev.typeId)
        if (before !== after) {
          await setAgentEventSubscription(token, {
            agentId: id,
            typeId: ev.typeId,
            subscribed: after,
          })
        }
      }

      if (displayName.trim() !== savedDisplayName.trim()) {
        await setAgentDisplayName(token, id, displayName.trim() || null)
        setSavedDisplayName(displayName.trim())
      }

      await load()
      setStatus('ההגדרות נשמרו ✓')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שמירה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  const onRunNow = async () => {
    if (!token || !id) return
    setRunning(true)
    setStatus(null)
    setError(null)
    try {
      const res = await runAgent(token, id)
      if (res.ok) {
        setStatus('הסוכן סיים — התוצאה נשלחה להתראות')
        await load()
      } else {
        setError(res.error ?? 'ההרצה נכשלה')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ההרצה נכשלה')
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  if (!config) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>לא נמצאו הגדרות לסוכן</Text>
      </View>
    )
  }

  const suggestedChips = config.suggestedScheduleTimes.map((t) => ({
    key: t,
    label: t,
  }))

  return (
    <FormSheetScaffold
      title={config.name}
      onSave={() => void onSave()}
      saving={saving}
      saveDisabled={!dirty}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status ? <Text style={styles.ok}>{status}</Text> : null}

      <Text style={styles.sectionTitle}>שם תצוגה</Text>
      <TextInput
        style={styles.input}
        value={displayName}
        onChangeText={setDisplayName}
        placeholder={config.name}
        placeholderTextColor={colors.textMuted}
        textAlign="right"
      />

      <ToggleRow
        label="הרצה לפי שעה"
        description="הסוכן ירוץ אוטומטית בשעות שתגדיר"
        value={enabled}
        disabled={saving || times.length === 0}
        onValueChange={setEnabled}
      />

      <Text style={styles.sectionTitle}>שעות הרצה</Text>
      <FilterChips
        items={times.map((t) => ({ key: t, label: t }))}
        selectedKeys={times}
        onSelect={(key) => {
          const next = times.filter((t) => t !== key)
          setTimes(next)
          if (next.length === 0) setEnabled(false)
        }}
      />

      {suggestedChips.length > 0 ? (
        <FilterChips
          items={suggestedChips}
          selectedKeys={[]}
          onSelect={(key) => addTime(key)}
        />
      ) : null}

      <View style={styles.timeRow}>
        <TextInput
          style={[styles.input, styles.timeInput]}
          value={newTime}
          onChangeText={setNewTime}
          placeholder="07:00"
          placeholderTextColor={colors.textMuted}
          keyboardType="numbers-and-punctuation"
          textAlign="center"
        />
        <Pressable
          style={[styles.runBtn, !newTime.trim() && styles.runBtnDisabled]}
          onPress={() => addTime(newTime)}
          disabled={!newTime.trim()}
        >
          <Text style={styles.runBtnText}>הוסף שעה</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>הרצה לפי אירוע</Text>
      <View style={styles.group}>
        {events.map((ev) => {
          const checked = subscribedEvents.includes(ev.typeId)
          const owner = ev.routedAgentId
          const takenByOther = !!owner && owner !== id
          return (
            <Pressable
              key={ev.typeId}
              style={styles.eventRow}
              onPress={() =>
                setSubscribedEvents((prev) =>
                  checked ? prev.filter((x) => x !== ev.typeId) : [...prev, ev.typeId].sort(),
                )
              }
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
            >
              <Text style={styles.check}>{checked ? '☑' : '☐'}</Text>
              <View style={styles.eventText}>
                <Text style={styles.eventLabel}>{ev.label}</Text>
                <Text style={styles.eventDesc}>{ev.description}</Text>
                {takenByOther && !checked ? (
                  <Text style={styles.eventWarn}>
                    מטופל על ידי {agentNameById.get(owner!) ?? owner}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          )
        })}
      </View>

      <Text style={styles.sectionTitle}>הוראות להרצה</Text>
      <TextInput
        style={[styles.input, styles.textarea]}
        value={triggerMessage}
        onChangeText={setTriggerMessage}
        placeholder={config.defaultTriggerMessage}
        placeholderTextColor={colors.textMuted}
        multiline
        textAlign="right"
        textAlignVertical="top"
      />

      <View style={styles.actions}>
        <Pressable
          style={[styles.runBtn, running && styles.runBtnDisabled]}
          onPress={() => void onRunNow()}
          disabled={running || saving}
        >
          <Text style={styles.runBtnText}>{running ? 'מריץ…' : 'הרץ עכשיו'}</Text>
        </Pressable>
      </View>

      <Text style={styles.lastRun}>
        ריצה אחרונה: {formatLastRun(config.lastRunAt)}
        {config.lastRunStatus === 'ok' ? ' · הצליחה' : ''}
        {config.lastRunStatus === 'error' && config.lastRunError
          ? ` · נכשלה: ${config.lastRunError}`
          : ''}
      </Text>
    </FormSheetScaffold>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  muted: { color: colors.textMuted, writingDirection: 'rtl' },
  sectionTitle: {
    color: colors.gold,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 12,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
  },
  textarea: { minHeight: 96 },
  timeRow: { flexDirection: 'row-reverse', gap: 8, alignItems: 'center', marginTop: 8 },
  timeInput: { flex: 1, maxWidth: 120 },
  group: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  eventRow: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceCard,
  },
  check: { color: colors.accent, fontSize: 18, width: 24 },
  eventText: { flex: 1, gap: 4 },
  eventLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  eventDesc: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  eventWarn: {
    color: colors.coral,
    fontSize: 12,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  actions: { flexDirection: 'row-reverse', marginTop: 16 },
  runBtn: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  runBtnDisabled: { opacity: 0.4 },
  runBtnText: { color: colors.text, fontWeight: '600', writingDirection: 'rtl' },
  lastRun: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 12,
  },
  error: { color: colors.error, textAlign: 'right', writingDirection: 'rtl' },
  ok: { color: colors.success, textAlign: 'right', writingDirection: 'rtl' },
})
