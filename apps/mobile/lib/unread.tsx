import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { AppState } from 'react-native'
import { createTrpcClient } from './trpc'
import { useAuth } from './auth'

type UnreadState = {
  count: number
  refresh: () => Promise<void>
}

const UnreadContext = createContext<UnreadState | null>(null)

export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth()
  const [count, setCount] = useState(0)

  const refresh = useCallback(async () => {
    if (!token) {
      setCount(0)
      return
    }
    try {
      const client = createTrpcClient(token)
      const res = (await client.notifications.unreadCount.query()) as { count: number }
      setCount(res.count ?? 0)
    } catch {
      // Keep last known count on transient errors.
    }
  }, [token])

  useEffect(() => {
    void refresh()
    if (!token) return
    const interval = setInterval(() => void refresh(), 30_000)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh()
    })
    return () => {
      clearInterval(interval)
      sub.remove()
    }
  }, [token, refresh])

  const value = useMemo(() => ({ count, refresh }), [count, refresh])
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>
}

export function useUnread(): UnreadState {
  const ctx = useContext(UnreadContext)
  if (!ctx) throw new Error('useUnread must be used within UnreadProvider')
  return ctx
}
