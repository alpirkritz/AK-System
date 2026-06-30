import * as Google from 'expo-auth-session/providers/google'
import * as WebBrowser from 'expo-web-browser'
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

WebBrowser.maybeCompleteAuthSession()

export default function LoginScreen() {
  const { signIn } = useAuth()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? ''
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId,
    androidClientId: androidClientId || webClientId,
  })

  useEffect(() => {
    if (response?.type !== 'success') return
    const idToken = response.params.id_token
    if (!idToken) {
      setError('לא התקבל id_token מ-Google')
      return
    }

    ;(async () => {
      setBusy(true)
      setError(null)
      try {
        const { accessToken, user } = await signInWithGoogleIdToken(idToken)
        await signIn(accessToken, user)
        try {
          await syncPushToken(accessToken)
        } catch {
          // Push is optional on first login
        }
        router.replace('/chat')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'התחברות נכשלה')
      } finally {
        setBusy(false)
      }
    })()
  }, [response, signIn, router])

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
        ) : (
          <Pressable
            style={[styles.button, (!request || busy) && styles.buttonDisabled]}
            disabled={!request || busy}
            onPress={() => promptAsync()}
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
