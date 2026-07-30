import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import * as Notifications from 'expo-notifications'
import {
  API_URL,
  registerExpoPushToken,
  sendTestPush,
  unregisterExpoPushToken,
} from '../lib/api'
import { useAuth } from '../lib/auth'
import { ensurePushPermissions, getExpoPushToken } from '../lib/notifications'
import { colors } from '../lib/theme'

export default function SettingsScreen() {
  const { token, user, signOut } = useAuth()
  const router = useRouter()
  const [pushStatus, setPushStatus] = useState<string | null>(null)
  const [permission, setPermission] = useState<string>('unknown')
  const [expoToken, setExpoToken] = useState<string | null>(null)
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
      const pushToken = await getExpoPushToken()
      if (!pushToken) {
        setPushStatus('לא התקבל token מהמכשיר')
        return
      }
      await registerExpoPushToken(token, pushToken)
      setExpoToken(pushToken)
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
      setPushStatus(`נשלח: ${res.webSent} PWA + ${res.expoSent} ARO`)
    } catch (err) {
      setPushStatus(err instanceof Error ? err.message : 'בדיקה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  const onSignOut = async () => {
    if (token) {
      const expoToken = await getExpoPushToken()
      if (expoToken) {
        try {
          await unregisterExpoPushToken(token, expoToken)
        } catch {
          // ignore
        }
      }
    }
    await signOut()
    router.replace('/login')
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
        <Text style={styles.label}>משתמש</Text>
        <Text style={styles.value}>{user?.name ?? user?.email ?? '—'}</Text>
        <Text style={styles.muted}>{user?.email}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>שרת</Text>
        <Text style={styles.muted}>{API_URL || 'לא מוגדר'}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>התראות Push</Text>
        <Text style={styles.muted}>סטטוס: {permLabel}</Text>
        {expoToken ? (
          <Text style={styles.muted} numberOfLines={1}>
            token: {expoToken.replace('ExponentPushToken[', '…').slice(0, 24)}
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

      <Pressable style={[styles.button, styles.danger]} onPress={onSignOut}>
        <Text style={styles.buttonText}>התנתק</Text>
      </Pressable>
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
  section: {
    gap: 4,
  },
  label: {
    color: colors.gold,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  value: {
    color: colors.text,
    fontSize: 18,
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
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  danger: {
    borderColor: colors.error,
    marginTop: 'auto',
  },
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
