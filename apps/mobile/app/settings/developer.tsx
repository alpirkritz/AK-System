import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import * as Notifications from 'expo-notifications'
import { API_URL, registerFcmPushToken, sendTestPush } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { ensurePushPermissions, getFcmPushToken } from '../../lib/notifications'
import { colors } from '../../lib/theme'

export default function DeveloperSettingsScreen() {
  const { token } = useAuth()
  const [pushStatus, setPushStatus] = useState<string | null>(null)
  const [permission, setPermission] = useState<string>('unknown')
  const [fcmToken, setFcmToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Notifications.getPermissionsAsync().then(({ status }) => setPermission(status))
  }, [])

  const onEnablePush = async () => {
    if (!token) return
    setBusy(true)
    setPushStatus(null)
    const granted = await ensurePushPermissions()
    const { status } = await Notifications.getPermissionsAsync()
    setPermission(status)
    if (!granted) {
      setPushStatus('הרשאת התראות נדחתה')
      setBusy(false)
      return
    }
    try {
      const pushToken = await getFcmPushToken()
      if (!pushToken) {
        setPushStatus('לא התקבל token מהמכשיר')
        return
      }
      await registerFcmPushToken(token, pushToken)
      setFcmToken(pushToken)
      setPushStatus('התראות הופעלו ורשומות בשרת ✓')
    } catch (err) {
      setPushStatus(err instanceof Error ? err.message : 'הפעלה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  const onTestPush = async () => {
    if (!token) return
    setBusy(true)
    setPushStatus(null)
    try {
      const res = await sendTestPush(token)
      setPushStatus(`נשלח: ${res.webSent} PWA + ${res.fcmSent} ARO (FCM)`)
    } catch (err) {
      setPushStatus(err instanceof Error ? err.message : 'בדיקה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  const permLabel =
    permission === 'granted'
      ? 'מופעל ✓'
      : permission === 'denied'
        ? 'חסום במכשיר'
        : permission === 'unknown'
          ? 'טוען...'
          : 'כבוי'

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.label}>שרת</Text>
        <Text style={styles.muted}>{API_URL || 'לא מוגדר'}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>התראות Push (FCM)</Text>
        <Text style={styles.muted}>סטטוס: {permLabel}</Text>
        {fcmToken ? (
          <Text style={styles.muted} numberOfLines={1}>
            token: …{fcmToken.slice(-24)}
          </Text>
        ) : null}
      </View>

      <Pressable style={styles.button} onPress={onEnablePush} disabled={busy}>
        <Text style={styles.buttonText}>
          {permission === 'granted' ? 'רענן רישום Push' : 'הפעל התראות Push'}
        </Text>
      </Pressable>

      <Pressable
        style={[styles.button, permission !== 'granted' && styles.buttonDisabled]}
        onPress={onTestPush}
        disabled={busy || permission !== 'granted'}
      >
        <Text style={styles.buttonText}>שלח בדיקה</Text>
      </Pressable>

      {pushStatus ? <Text style={styles.status}>{pushStatus}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 20,
    gap: 20,
  },
  section: { gap: 4 },
  label: {
    color: colors.gold,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  muted: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'right',
  },
  button: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
    writingDirection: 'rtl',
  },
  status: {
    color: colors.textMuted,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
})
