import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ChatMessage } from '../../lib/api'
import { fetchChatHistory, sendChatMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { addNotificationResponseListener, syncPushToken } from '../../lib/notifications'
import { colors, layout } from '../../lib/theme'

type Row = ChatMessage | { id: string; role: 'typing'; content: string; createdAt: string }

export default function ChatScreen() {
  const { token } = useAuth()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const listRef = useRef<FlatList<Row>>(null)

  const [messages, setMessages] = useState<Row[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pushNotice, setPushNotice] = useState<string | null>(null)

  const contentWidth = Math.min(width - 24, layout.maxContentWidth)

  const loadHistory = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const rows = await fetchChatHistory(token)
      setMessages(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינת היסטוריה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    if (!token) return
    syncPushToken(token)
      .then((registered) => {
        setPushNotice(registered ? null : 'התראות לא פעילות — הפעל אותן בהגדרות')
      })
      .catch((err) => {
        console.warn('[aro] push token sync failed:', err)
        setPushNotice('רישום התראות נכשל — נסה שוב מההגדרות')
      })
  }, [token])

  useEffect(() => {
    const sub = addNotificationResponseListener((url) => {
      if (url.includes('chat')) {
        router.push('/chat')
      } else {
        router.push('/notifications')
      }
    })
    return () => sub.remove()
  }, [router])

  const onSend = async () => {
    const text = input.trim()
    if (!text || !token || sending) return

    setInput('')
    setSending(true)
    setError(null)

    const optimistic: Row = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic, { id: 'typing', role: 'typing', content: '', createdAt: '' }])

    try {
      const { assistantMessage } = await sendChatMessage(token, text)
      const assistant: Row = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: assistantMessage,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev.filter((m) => m.role !== 'typing'), assistant])
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.role !== 'typing'))
      setError(err instanceof Error ? err.message : 'שליחה נכשלה')
    } finally {
      setSending(false)
    }
  }

  const renderItem = ({ item }: { item: Row }) => {
    if (item.role === 'typing') {
      return (
        <View style={[styles.row, styles.rowAssistant]}>
          <View style={[styles.bubble, styles.bubbleAssistant, { maxWidth: contentWidth * 0.85 }]}>
            <ActivityIndicator color={colors.accent} size="small" />
          </View>
        </View>
      )
    }

    const isUser = item.role === 'user'
    return (
      <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
        <View
          style={[
            styles.bubble,
            isUser ? styles.bubbleUser : styles.bubbleAssistant,
            { maxWidth: contentWidth * 0.85 },
          ]}
        >
          <Text style={styles.messageText}>{item.content}</Text>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
    >
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 8 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {pushNotice ? (
        <Pressable onPress={() => router.push('/settings')}>
          <Text style={styles.pushNotice}>{pushNotice}</Text>
        </Pressable>
      ) : null}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="כתוב להוגו..."
          placeholderTextColor={colors.textMuted}
          multiline
          textAlign="right"
          editable={!sending}
        />
        <Pressable
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
          onPress={onSend}
          disabled={!input.trim() || sending}
        >
          <Text style={styles.sendText}>שלח</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: {
    paddingHorizontal: 12,
    paddingTop: 12,
    flexGrow: 1,
  },
  row: {
    marginBottom: 10,
    flexDirection: 'row',
  },
  rowUser: {
    justifyContent: 'flex-end',
  },
  rowAssistant: {
    justifyContent: 'flex-start',
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: colors.userBubble,
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: colors.assistantBubble,
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  messageText: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  composer: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 16,
  },
  sendBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendText: {
    color: colors.bg,
    fontWeight: '600',
    fontSize: 15,
  },
  error: {
    color: colors.error,
    textAlign: 'center',
    padding: 8,
    writingDirection: 'rtl',
  },
  pushNotice: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 12,
    paddingBottom: 6,
    textDecorationLine: 'underline',
    writingDirection: 'rtl',
  },
})
