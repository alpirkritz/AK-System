import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { API_URL, signInWithGoogleIdToken } from '../lib/api'
import { useAuth } from '../lib/auth'
import { syncPushToken } from '../lib/notifications'
import { colors, layout } from '../lib/theme'

export default function LoginScreen() {
  const { signIn } = useAuth()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? ''
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?.trim()

  useEffect(() => {
    if (!webClientId) return
    GoogleSignin.configure({
      webClientId,
      offlineAccess: false,
    })
  }, [webClientId])

  async function handleGoogleSignIn() {
    if (!webClientId || !androidClientId) return
    setBusy(true)
    setError(null)
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })
      const response = await GoogleSignin.signIn()
      if (!isSuccessResponse(response)) {
        return
      }
      const idToken = response.data.idToken
      if (!idToken) {
        setError('לא התקבל id_token מ-Google')
        return
      }
      const { accessToken, user } = await signInWithGoogleIdToken(idToken)
      await signIn(accessToken, user)
      try {
        await syncPushToken(accessToken)
      } catch (err) {
        // Push is optional on first login — log so failures are diagnosable.
        console.warn('[helm] push token sync failed on login:', err)
      }
      router.replace('/chat')
    } catch (err) {
      if (isErrorWithCode(err)) {
        if (err.code === statusCodes.SIGN_IN_CANCELLED) return
        if (err.code === statusCodes.IN_PROGRESS) return
        if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          setError('Google Play Services לא זמין בטלפון')
          return
        }
      }
      setError(err instanceof Error ? err.message : 'התחברות נכשלה')
    } finally {
      setBusy(false)
    }
  }

  const contentWidth = Math.min(width - 32, layout.maxContentWidth)

  return (
    <View style={styles.container}>
      <View style={[styles.card, { maxWidth: contentWidth }]}>
        <Text style={styles.title}>Helm</Text>
        <Text style={styles.tagline}>הגה — העוזר האישי שלך</Text>

        {!API_URL ? (
          <Text style={styles.error}>
            הגדר EXPO_PUBLIC_API_URL ב-.env (כתובת production ב-HTTPS)
          </Text>
        ) : !webClientId ? (
          <Text style={styles.error}>הגדר EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ב-.env</Text>
        ) : !androidClientId ? (
          <Text style={styles.error}>
            חסר Android OAuth client — הוסף EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ובנה APK מחדש
          </Text>
        ) : (
          <Pressable
            style={[styles.button, busy && styles.buttonDisabled]}
            disabled={busy}
            onPress={() => void handleGoogleSignIn()}
          >
            {busy ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={styles.buttonText}>התחבר עם Google</Text>
            )}
          </Pressable>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {API_URL ? (
          <Text style={styles.hint} numberOfLines={2}>
            שרת: {API_URL}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    alignItems: 'center',
    gap: 16,
  },
  title: {
    fontSize: 42,
    fontWeight: '700',
    color: colors.gold,
    writingDirection: 'rtl',
  },
  tagline: {
    fontSize: 18,
    color: colors.textMuted,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  button: {
    marginTop: 24,
    backgroundColor: colors.gold,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    minWidth: 220,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: '600',
    writingDirection: 'rtl',
  },
  error: {
    color: colors.error,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  hint: {
    marginTop: 8,
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
})
