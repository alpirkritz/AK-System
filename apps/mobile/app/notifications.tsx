import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import type { AppNotification } from '../lib/api'
import {
  fetchNotifications,
  markNotificationRead,
} from '../lib/api'
import { useAuth } from '../lib/auth'
import { colors } from '../lib/theme'

const TYPE_ICONS: Record<string, string> = {
  cron: '⏰',
  agent: '🤖',
  fomo: '🔔',
  hugo: '💬',
  system: '✓',
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'עכשיו'
  if (mins < 60) return `לפני ${mins} דק׳`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `לפני ${hours} שע׳`
  return `לפני ${Math.floor(hours / 24)} ימים`
}

function routeForUrl(url: string): '/chat' | '/notifications' {
  if (url.includes('chat')) return '/chat'
  return '/notifications'
}

export default function NotificationsScreen() {
  const { token } = useAuth()
  const router = useRouter()
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchNotifications(token)
      setItems(data.notifications)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  const onOpen = async (item: AppNotification) => {
    if (!token) return
    if (!item.readAt) {
      try {
        await markNotificationRead(token, { id: item.id })
        setItems((prev) =>
          prev.map((n) =>
            n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n,
          ),
        )
      } catch {
        // continue navigation
      }
    }
    router.push(routeForUrl(item.url))
  }

  const onMarkAll = async () => {
    if (!token) return
    try {
      await markNotificationRead(token, { all: true })
      setItems((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'סימון נכשל')
    }
  }

  const unread = items.filter((n) => !n.readAt).length

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {unread > 0 && (
        <Pressable style={styles.markAll} onPress={onMarkAll}>
          <Text style={styles.markAllText}>סמן הכל כנקרא</Text>
        </Pressable>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={styles.emptyText}>אין התראות עדיין</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.card, !item.readAt && styles.cardUnread]}
              onPress={() => onOpen(item)}
            >
              <View style={styles.cardRow}>
                <Text style={styles.icon}>{TYPE_ICONS[item.type] ?? '🔔'}</Text>
                <View style={styles.cardBody}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.title} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.time}>{formatRelative(item.createdAt)}</Text>
                  </View>
                  <Text style={styles.body} numberOfLines={2}>
                    {item.body}
                  </Text>
                </View>
                {!item.readAt && <View style={styles.dot} />}
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  markAll: {
    alignSelf: 'flex-end',
    margin: 16,
    marginBottom: 0,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  markAllText: {
    color: colors.gold,
    fontSize: 14,
    writingDirection: 'rtl',
  },
  list: {
    padding: 16,
    gap: 10,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  cardUnread: {
    borderColor: colors.gold,
  },
  cardRow: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 10,
  },
  icon: {
    fontSize: 22,
  },
  cardBody: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  time: {
    color: colors.textMuted,
    fontSize: 11,
  },
  body: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'right',
    writingDirection: 'rtl',
    lineHeight: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.gold,
    marginTop: 6,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 16,
    writingDirection: 'rtl',
  },
  error: {
    color: colors.error,
    textAlign: 'center',
    padding: 12,
    writingDirection: 'rtl',
  },
})
