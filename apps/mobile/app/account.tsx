import { useRouter } from 'expo-router'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { Avatar } from '../components/Avatar'
import { API_URL, unregisterFcmPushToken } from '../lib/api'
import { useAuth } from '../lib/auth'
import { getFcmPushToken } from '../lib/notifications'
import { colors } from '../lib/theme'

export default function AccountScreen() {
  const { token, user, signOut } = useAuth()
  const router = useRouter()

  const onSignOut = () => {
    Alert.alert('להתנתק מהמכשיר?', 'תישאר מחובר באתר ובמכשירים אחרים.', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'התנתק',
        style: 'destructive',
        onPress: async () => {
          if (token) {
            const deviceToken = await getFcmPushToken()
            if (deviceToken) {
              try {
                await unregisterFcmPushToken(token, deviceToken)
              } catch {
                // ignore
              }
            }
          }
          await signOut()
          router.replace('/login')
        },
      },
    ])
  }

  return (
    <View style={styles.container}>
      <View style={styles.profile}>
        <Avatar name={user?.name ?? user?.email} size={64} />
        <Text style={styles.name}>{user?.name ?? '—'}</Text>
        <Text style={styles.email}>{user?.email}</Text>
      </View>

      <Pressable style={[styles.button, styles.danger]} onPress={onSignOut}>
        <Text style={styles.buttonText}>התנתק</Text>
      </Pressable>
      <Text style={styles.hint}>שרת: {API_URL || 'לא מוגדר'}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, gap: 24 },
  profile: { alignItems: 'center', gap: 8, paddingTop: 12 },
  name: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  email: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
  button: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
  },
  danger: { borderColor: colors.error },
  buttonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
    writingDirection: 'rtl',
  },
  hint: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
})
