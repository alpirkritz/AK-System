import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { FormSheetScaffold } from '../../components/FormSheetScaffold'
import { useAuth } from '../../lib/auth'
import {
  deleteMeeting,
  fetchMeeting,
  fetchMeetingSeries,
  updateMeeting,
  updateSeriesNotes,
} from '../../lib/data'
import { colors } from '../../lib/theme'

function toDateInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDateLabel(value: string): string {
  const date = parseDateInput(value)
  if (!date) return value
  return date.toLocaleDateString('he-IL', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function parseTimeInput(value: string): { h: number; m: number } {
  const [h = 9, m = 0] = (value || '09:00').split(':').map(Number)
  return { h, m }
}

function toTimeInput(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export default function MeetingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { token } = useAuth()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')
  const [notes, setNotes] = useState('')
  const [seriesId, setSeriesId] = useState<string | null>(null)
  const [rollingNotes, setRollingNotes] = useState('')

  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [timePickerOpen, setTimePickerOpen] = useState(false)

  const load = useCallback(async () => {
    if (!token || !id) return
    setLoading(true)
    setError(null)
    try {
      const meeting = await fetchMeeting(token, id)
      if (!meeting) {
        setError('הפגישה לא נמצאה')
        return
      }
      setTitle(meeting.title)
      setDate(meeting.date)
      setTime(meeting.time || '09:00')
      setNotes(meeting.notes ?? '')
      setSeriesId(meeting.seriesId ?? null)
      if (meeting.seriesId) {
        const series = await fetchMeetingSeries(token, meeting.seriesId)
        setRollingNotes(series?.rollingNotes ?? '')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [token, id])

  useEffect(() => {
    void load()
  }, [load])

  const onPickDate = (event: DateTimePickerEvent, picked?: Date) => {
    if (Platform.OS !== 'ios') setDatePickerOpen(false)
    if (event.type === 'dismissed' || !picked) return
    setDate(toDateInput(picked))
  }

  const onPickTime = (event: DateTimePickerEvent, picked?: Date) => {
    if (Platform.OS !== 'ios') setTimePickerOpen(false)
    if (event.type === 'dismissed' || !picked) return
    setTime(toTimeInput(picked.getHours(), picked.getMinutes()))
  }

  const onSave = async () => {
    if (!token || !id) return
    const trimmed = title.trim()
    if (!trimmed) {
      setError('צריך כותרת לפגישה')
      return
    }
    if (!date) {
      setError('צריך תאריך')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await updateMeeting(token, {
        id,
        title: trimmed,
        date,
        time,
        notes: notes.trim() || null,
      })
      if (seriesId) {
        await updateSeriesNotes(token, seriesId, rollingNotes)
      }
      router.back()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שמירה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = () => {
    Alert.alert('מחיקת פגישה', 'למחוק את הפגישה?', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (!token || !id) return
            try {
              await deleteMeeting(token, id)
              router.back()
            } catch {
              setError('מחיקה נכשלה')
            }
          })()
        },
      },
    ])
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  const { h, m } = parseTimeInput(time)
  const timeDate = new Date()
  timeDate.setHours(h, m, 0, 0)

  return (
    <FormSheetScaffold
      title="פרטי פגישה"
      onSave={() => void onSave()}
      saving={saving}
      saveDisabled={!title.trim() || !date}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.label}>כותרת</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="שם הפגישה"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, styles.inputRtl]}
        textAlign="right"
      />

      <Text style={styles.label}>תאריך</Text>
      <Pressable
        onPress={() => setDatePickerOpen(true)}
        style={[styles.input, styles.fieldBtn]}
        accessibilityRole="button"
      >
        <Text style={styles.fieldText}>{date ? formatDateLabel(date) : 'בחר תאריך'}</Text>
      </Pressable>
      {datePickerOpen ? (
        <DateTimePicker
          value={parseDateInput(date) ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={onPickDate}
          themeVariant="dark"
        />
      ) : null}
      {datePickerOpen && Platform.OS === 'ios' ? (
        <Pressable onPress={() => setDatePickerOpen(false)} style={styles.pickerDone}>
          <Text style={styles.pickerDoneText}>סיום</Text>
        </Pressable>
      ) : null}

      <Text style={styles.label}>שעה</Text>
      <Pressable
        onPress={() => setTimePickerOpen(true)}
        style={[styles.input, styles.fieldBtn]}
        accessibilityRole="button"
      >
        <Text style={styles.fieldText}>{time}</Text>
      </Pressable>
      {timePickerOpen ? (
        <DateTimePicker
          value={timeDate}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onPickTime}
          themeVariant="dark"
        />
      ) : null}
      {timePickerOpen && Platform.OS === 'ios' ? (
        <Pressable onPress={() => setTimePickerOpen(false)} style={styles.pickerDone}>
          <Text style={styles.pickerDoneText}>סיום</Text>
        </Pressable>
      ) : null}

      <Text style={styles.label}>הערות</Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        placeholder="הערות לפגישה…"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, styles.inputRtl, styles.multiline]}
        textAlign="right"
        multiline
      />

      {seriesId ? (
        <>
          <Text style={styles.label}>הערות סדרה (מתגלגלות)</Text>
          <TextInput
            value={rollingNotes}
            onChangeText={setRollingNotes}
            placeholder="הערות שמתגלגלות בין מופעי הסדרה…"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.inputRtl, styles.multiline]}
            textAlign="right"
            multiline
          />
        </>
      ) : null}

      <Pressable
        onPress={onDelete}
        style={styles.deleteBtn}
        accessibilityRole="button"
        accessibilityLabel="מחק פגישה"
      >
        <Text style={styles.deleteText}>מחק פגישה</Text>
      </Pressable>
    </FormSheetScaffold>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 12,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
  },
  inputRtl: { writingDirection: 'rtl' },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  fieldBtn: { justifyContent: 'center' },
  fieldText: { color: colors.text, fontSize: 16, textAlign: 'right', writingDirection: 'rtl' },
  pickerDone: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  pickerDoneText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  error: { color: colors.error, textAlign: 'center', writingDirection: 'rtl', paddingVertical: 4 },
  deleteBtn: {
    marginTop: 32,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.coral + '66',
  },
  deleteText: { color: colors.coral, fontSize: 16, fontWeight: '600', writingDirection: 'rtl' },
})
