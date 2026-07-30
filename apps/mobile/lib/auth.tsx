import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { AuthUser } from './api'

const TOKEN_KEY = 'helm_access_token'
const USER_KEY = 'helm_user'

/** SecureStore is native-only; use localStorage for web preview. */
const storage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    }
    return SecureStore.getItemAsync(key)
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value)
      return
    }
    await SecureStore.setItemAsync(key, value)
  },
  async deleteItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key)
      return
    }
    await SecureStore.deleteItemAsync(key)
  },
}

type AuthState = {
  token: string | null
  user: AuthUser | null
  loading: boolean
  signIn: (accessToken: string, user: AuthUser) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const storedToken = await storage.getItem(TOKEN_KEY)
        const storedUser = await storage.getItem(USER_KEY)
        if (storedToken && storedUser) {
          setToken(storedToken)
          setUser(JSON.parse(storedUser) as AuthUser)
        }
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const signIn = useCallback(async (accessToken: string, nextUser: AuthUser) => {
    await storage.setItem(TOKEN_KEY, accessToken)
    await storage.setItem(USER_KEY, JSON.stringify(nextUser))
    setToken(accessToken)
    setUser(nextUser)
  }, [])

  const signOut = useCallback(async () => {
    await storage.deleteItem(TOKEN_KEY)
    await storage.deleteItem(USER_KEY)
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ token, user, loading, signIn, signOut }),
    [token, user, loading, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
