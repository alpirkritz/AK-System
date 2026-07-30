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
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { API_URL, signInLocalDev, signInWithGoogleIdToken } from '../lib/api'
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
  // Local bypass — Expo sets __DEV__ true for metro; never ship this as the only path.
  const showLocalLogin = typeof __DEV__ !== 'undefined' && __DEV__

  useEffect(() => {
    if (!webClientId) return
    GoogleSignin.configure({
      webClientId,
      offlineAccess: false,
    })
  }, [webClientId])

  async function completeSignIn(accessToken: string, user: { email: string; name: string }) {
    await signIn(accessToken, user)
    try {
      await syncPushToken(accessToken)
    } catch (err) {
      console.warn('[helm] push token sync failed on login:', err)
    }
    router.replace('/chat')
  }

  async function handleLocalSignIn() {
    if (!API_URL) return
    setBusy(true)
    setError(null)
    try {
      const { accessToken, user } = await signInLocalDev()
      await completeSignIn(accessToken, user)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'כניסה לוקאלית נכשלה — ודא שהשרת רץ על EXPO_PUBLIC_API_URL',
      )
    } finally {
      setBusy(false)
    }
  }

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
      await completeSignIn(accessToken, user)
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
  const googleReady = Boolean(API_URL && webClientId && androidClientId)

  return (
    <View style={styles.container}>
      <View style={[styles.card, { maxWidth: contentWidth }]}>
        <Image
          source={require('../assets/aro-logo.png')}
          style={styles.logo}
          accessibilityLabel="ARO"
        />
        <Text style={styles.tagline}>העוזר האישי שלך</Text>

        {!API_URL ? (
          <Text style={styles.error}>
            הגדר EXPO_PUBLIC_API_URL ב-.env (כתובת production ב-HTTPS)
          </Text>
        ) : null}

        {showLocalLogin && API_URL ? (
          <Pressable
            style={[styles.button, busy && styles.buttonDisabled]}
            disabled={busy}
            onPress={() => void handleLocalSignIn()}
          >
            {busy ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={styles.buttonText}>כניסה לוקאלית</Text>
            )}
          </Pressable>
        ) : null}

        {!showLocalLogin && !googleReady && API_URL ? (
          !webClientId ? (
            <Text style={styles.error}>הגדר EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ב-.env</Text>
          ) : (
            <Text style={styles.error}>
              חסר Android OAuth client — הוסף EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ובנה APK מחדש
            </Text>
          )
        ) : null}

        {googleReady ? (
          <Pressable
            style={[
              showLocalLogin ? styles.buttonSecondary : styles.button,
              busy && styles.buttonDisabled,
            ]}
            disabled={busy}
            onPress={() => void handleGoogleSignIn()}
          >
            {busy && !showLocalLogin ? (
              <ActivityIndicator color={showLocalLogin ? colors.gold : colors.bg} />
            ) : (
              <Text style={showLocalLogin ? styles.buttonSecondaryText : styles.buttonText}>
                התחבר עם Google
              </Text>
            )}
          </Pressable>
        ) : null}

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
  logo: {
    width: 128,
    height: 128,
    borderRadius: 28,
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
  buttonSecondary: {
    marginTop: 12,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.gold,
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
  buttonSecondaryText: {
    color: colors.gold,
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
