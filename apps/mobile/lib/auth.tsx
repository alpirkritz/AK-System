import * as SecureStore from 'expo-secure-store'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { AuthUser } from './api'

const TOKEN_KEY = 'helm_access_token'
const USER_KEY = 'helm_user'

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
        const storedToken = await SecureStore.getItemAsync(TOKEN_KEY)
        const storedUser = await SecureStore.getItemAsync(USER_KEY)
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
    await SecureStore.setItemAsync(TOKEN_KEY, accessToken)
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextUser))
    setToken(accessToken)
    setUser(nextUser)
  }, [])

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY)
    await SecureStore.deleteItemAsync(USER_KEY)
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
