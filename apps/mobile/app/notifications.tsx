import { useRouter, type Href } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import type { AppNotification } from '../lib/api'
import {
  archiveAllNotifications,
  archiveNotification,
  fetchNotifications,
  isNavigableNotificationUrl,
  markNotificationRead,
  mobileRouteForNotificationUrl,
  notificationPreview,
} from '../lib/api'
import { parseNotificationBody } from '../lib/notification-format'
import { useUnread } from '../lib/unread'
import { useAuth } from '../lib/auth'
import { colors } from '../lib/theme'

const TYPE_ICONS: Record<string, string> = {
  cron: '⏰',
  agent: '🤖',
  fomo: '🔔',
  hugo: '💬',
  system: '✓',
}

const SWIPE_THRESHOLD = 72

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'עכשיו'
  if (mins < 60) return `לפני ${mins} דק׳`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `לפני ${hours} שע׳`
  return `לפני ${Math.floor(hours / 24)} ימים`
}

function SwipeableNotification({
  item,
  onOpen,
  onArchive,
  onMarkRead,
}: {
  item: AppNotification
  onOpen: () => void
  onArchive: () => void
  onMarkRead: () => void
}) {
  const translateX = useRef(new Animated.Value(0)).current
  const dxRef = useRef(0)

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        dxRef.current = g.dx
        translateX.setValue(Math.max(-120, Math.min(120, g.dx)))
      },
      onPanResponderRelease: () => {
        const dx = dxRef.current
        dxRef.current = 0
        if (dx <= -SWIPE_THRESHOLD) {
          Animated.timing(translateX, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }).start()
          onArchive()
          return
        }
        if (dx >= SWIPE_THRESHOLD) {
          Animated.timing(translateX, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }).start()
          onMarkRead()
          return
        }
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 0,
        }).start()
      },
      onPanResponderTerminate: () => {
        dxRef.current = 0
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 0,
        }).start()
      },
    }),
  ).current

  return (
    <View style={styles.swipeWrap}>
      <View style={styles.swipeBg} pointerEvents="none">
        <Text style={styles.swipeRead}>סמן כנקרא</Text>
        <Text style={styles.swipeArchive}>ארכיון</Text>
      </View>
      <Animated.View
        style={[styles.card, !item.readAt && styles.cardUnread, { transform: [{ translateX }] }]}
        {...pan.panHandlers}
      >
        <Pressable onPress={onOpen} style={styles.cardPress} accessibilityRole="button">
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
                {notificationPreview(item.body)}
              </Text>
            </View>
            {!item.readAt && <View style={styles.dot} />}
          </View>
        </Pressable>
      </Animated.View>
    </View>
  )
}

export default function NotificationsScreen() {
  const { token } = useAuth()
  const router = useRouter()
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<AppNotification | null>(null)
  const [undoId, setUndoId] = useState<string | null>(null)
  const [bulkUndo, setBulkUndo] = useState<{ batchAt: string; count: number } | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bulkUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { refresh: refreshUnread } = useUnread()

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchNotifications(token)
      setItems(data.notifications)
      void refreshUnread()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [token, refreshUnread])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current)
      if (bulkUndoTimer.current) clearTimeout(bulkUndoTimer.current)
    }
  }, [])

  const onOpen = async (item: AppNotification) => {
    if (!token) return
    setSelected(item)
    if (!item.readAt) {
      try {
        await markNotificationRead(token, { id: item.id })
        setItems((prev) =>
          prev.map((n) =>
            n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n,
          ),
        )
      } catch {
        // detail still opens
      }
    }
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

  const onMarkRead = async (item: AppNotification) => {
    if (!token || item.readAt) return
    try {
      await markNotificationRead(token, { id: item.id })
      setItems((prev) =>
        prev.map((n) =>
          n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n,
        ),
      )
    } catch {
      setError('לא ניתן לעדכן את ההתראה. נסה שוב.')
    }
  }

  const onArchive = async (item: AppNotification) => {
    if (!token) return
    if (selected?.id === item.id) setSelected(null)
    try {
      await archiveNotification(token, item.id)
      setItems((prev) => prev.filter((n) => n.id !== item.id))
      setUndoId(item.id)
      if (undoTimer.current) clearTimeout(undoTimer.current)
      undoTimer.current = setTimeout(() => setUndoId(null), 4000)
    } catch {
      setError('לא ניתן לעדכן את ההתראה. נסה שוב.')
    }
  }

  const onUndo = async () => {
    if (!token || !undoId) return
    const id = undoId
    setUndoId(null)
    if (undoTimer.current) clearTimeout(undoTimer.current)
    try {
      await archiveNotification(token, id, true)
      await load()
    } catch {
      setError('לא ניתן לעדכן את ההתראה. נסה שוב.')
    }
  }

  const onArchiveAll = async () => {
    if (!token || items.length === 0) return
    try {
      const res = await archiveAllNotifications(token)
      setItems([])
      if (res.batchAt) {
        setBulkUndo({ batchAt: res.batchAt, count: res.updated })
        if (bulkUndoTimer.current) clearTimeout(bulkUndoTimer.current)
        bulkUndoTimer.current = setTimeout(() => setBulkUndo(null), 4000)
      }
    } catch {
      setError('לא ניתן לעדכן את ההתראה. נסה שוב.')
    }
  }

  const onBulkUndo = async () => {
    if (!token || !bulkUndo) return
    const { batchAt } = bulkUndo
    setBulkUndo(null)
    if (bulkUndoTimer.current) clearTimeout(bulkUndoTimer.current)
    try {
      await archiveAllNotifications(token, { undo: true, batchAt })
      await load()
    } catch {
      setError('לא ניתן לעדכן את ההתראה. נסה שוב.')
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
      {(unread > 0 || items.length > 0) && (
        <View style={styles.headerActions}>
          {unread > 0 && (
            <Pressable style={styles.markAll} onPress={onMarkAll}>
              <Text style={styles.markAllText}>סמן הכל כנקרא</Text>
            </Pressable>
          )}
          {items.length > 0 && (
            <Pressable style={styles.markAll} onPress={onArchiveAll}>
              <Text style={styles.archiveAllText}>העבר הכל לארכיון</Text>
            </Pressable>
          )}
        </View>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={styles.emptyText}>אין התראות כרגע</Text>
          <Text style={styles.emptyHint}>כשתגיע התראה חדשה — היא תופיע כאן</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <SwipeableNotification
              item={item}
              onOpen={() => onOpen(item)}
              onArchive={() => onArchive(item)}
              onMarkRead={() => onMarkRead(item)}
            />
          )}
        />
      )}

      {undoId ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>הועבר לארכיון · </Text>
          <Pressable onPress={onUndo}>
            <Text style={styles.toastUndo}>בטל</Text>
          </Pressable>
        </View>
      ) : null}

      {bulkUndo ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{bulkUndo.count} הודעות הועברו לארכיון · </Text>
          <Pressable onPress={onBulkUndo}>
            <Text style={styles.toastUndo}>בטל</Text>
          </Pressable>
        </View>
      ) : null}

      <Modal
        visible={!!selected}
        animationType="slide"
        transparent
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {selected ? (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{selected.title}</Text>
                  <Pressable
                    onPress={() => setSelected(null)}
                    style={styles.modalClose}
                    accessibilityLabel="סגור"
                  >
                    <Text style={styles.modalCloseText}>סגור</Text>
                  </Pressable>
                </View>
                <Text style={styles.modalMeta}>
                  {TYPE_ICONS[selected.type] ?? '🔔'} · {formatRelative(selected.createdAt)}
                </Text>
                <ScrollView
                  style={styles.modalScroll}
                  contentContainerStyle={styles.modalScrollContent}
                  showsVerticalScrollIndicator
                >
                  {parseNotificationBody(selected.body).map((block, i) => {
                    if (block.kind === 'heading') {
                      return (
                        <Text
                          key={i}
                          style={[
                            styles.modalHeading,
                            block.level === 1 && styles.modalHeadingTop,
                          ]}
                          selectable
                        >
                          {block.text}
                        </Text>
                      )
                    }
                    if (block.kind === 'bullet' || block.kind === 'numbered') {
                      return (
                        <View key={i} style={styles.modalListRow}>
                          <Text
                            style={
                              block.kind === 'bullet'
                                ? styles.modalBulletMark
                                : styles.modalNumberMark
                            }
                          >
                            {block.kind === 'bullet' ? '•' : `${block.marker}.`}
                          </Text>
                          <Text style={[styles.modalBody, styles.modalListText]} selectable>
                            {block.text}
                          </Text>
                        </View>
                      )
                    }
                    return (
                      <Text key={i} style={[styles.modalBody, styles.modalParagraph]} selectable>
                        {block.text}
                      </Text>
                    )
                  })}
                </ScrollView>
                <View style={styles.modalActions}>
                  {isNavigableNotificationUrl(selected.url) ? (
                    <Pressable
                      style={styles.primaryBtn}
                      onPress={() => {
                        const target = mobileRouteForNotificationUrl(selected.url)
                        setSelected(null)
                        // `as Href` matches the app's convention for routes the
                        // stale generated router.d.ts does not list yet.
                        router.push(
                          (target.message
                            ? { pathname: target.pathname, params: { message: target.message } }
                            : target.pathname) as Href,
                        )
                      }}
                    >
                      <Text style={styles.primaryBtnText}>עבור ליעד</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={styles.ghostBtn}
                    onPress={() => onArchive(selected)}
                  >
                    <Text style={styles.archiveBtnText}>ארכיון</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
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
  headerActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    margin: 16,
    marginBottom: 0,
  },
  markAll: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  markAllText: {
    color: colors.gold,
    fontSize: 14,
    writingDirection: 'rtl',
  },
  archiveAllText: {
    color: '#f0a0a0',
    fontSize: 14,
    writingDirection: 'rtl',
  },
  list: {
    padding: 16,
    gap: 10,
  },
  swipeWrap: {
    marginBottom: 10,
    borderRadius: 12,
    overflow: 'hidden',
  },
  swipeBg: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
  },
  swipeRead: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: '600',
  },
  swipeArchive: {
    color: '#f0a0a0',
    fontSize: 13,
    fontWeight: '600',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardUnread: {
    borderColor: colors.gold,
  },
  cardPress: {
    padding: 14,
    minHeight: 44,
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
  emptyHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 6,
    writingDirection: 'rtl',
    opacity: 0.8,
  },
  error: {
    color: colors.error,
    textAlign: 'center',
    padding: 12,
    writingDirection: 'rtl',
  },
  toast: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    flexDirection: 'row-reverse',
    backgroundColor: '#1d2b46',
    borderWidth: 1,
    borderColor: '#2f4368',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  toastText: {
    color: '#eef3fb',
    fontSize: 13,
    writingDirection: 'rtl',
  },
  toastUndo: {
    color: colors.gold,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 36,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  modalTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  modalClose: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseText: {
    color: colors.gold,
    fontSize: 14,
  },
  modalMeta: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 12,
    writingDirection: 'rtl',
  },
  // flexShrink lets the body absorb the leftover height inside the card's 85%
  // cap instead of pushing the action row off-screen.
  modalScroll: {
    flexShrink: 1,
  },
  modalScrollContent: {
    paddingBottom: 4,
  },
  modalBody: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  modalParagraph: {
    marginBottom: 8,
  },
  modalHeading: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
    marginTop: 10,
    marginBottom: 4,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  modalHeadingTop: {
    fontSize: 17,
  },
  modalListRow: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  modalListText: {
    flex: 1,
  },
  modalBulletMark: {
    color: colors.accent,
    fontSize: 15,
    lineHeight: 22,
  },
  modalNumberMark: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  modalActions: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 20,
  },
  primaryBtn: {
    backgroundColor: colors.gold,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: colors.bg,
    fontWeight: '700',
    fontSize: 14,
  },
  ghostBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  archiveBtnText: {
    color: '#f0a0a0',
    fontSize: 14,
  },
})
