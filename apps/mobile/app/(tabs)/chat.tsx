import { useLocalSearchParams, useNavigation, useRouter, type Href } from 'expo-router'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  AgentPickerSheet,
  GENERAL_AGENT_ID,
} from '../../components/AgentPickerSheet'
import type { ChatMessage } from '../../lib/api'
import {
  fetchAgentHistory,
  fetchAgents,
  fetchChatHistory,
  sendAgentMessage,
  sendChatMessage,
} from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { syncPushToken } from '../../lib/notifications'
import { SELECTED_AGENT_KEY, storage } from '../../lib/storage'
import { composerLiftPx } from '../../lib/composer-keyboard'
import { colors, layout } from '../../lib/theme'

type Row = ChatMessage | { id: string; role: 'typing'; content: string; createdAt: string }

export default function ChatScreen() {
  const { token } = useAuth()
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { width, height: windowHeight } = useWindowDimensions()
  const restingWindowHeight = useRef(windowHeight)
  const listRef = useRef<FlatList<Row>>(null)
  const { message: messageParam, agent: agentParam } = useLocalSearchParams<{
    message?: string
    agent?: string
  }>()
  const deepLinkHandled = useRef<string | null>(null)

  const [selectedId, setSelectedId] = useState(GENERAL_AGENT_ID)
  const [agents, setAgents] = useState<Array<{ id: string; name: string; role: string }>>([])
  const [engine, setEngine] = useState('gemini')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [messages, setMessages] = useState<Row[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pushNotice, setPushNotice] = useState<string | null>(null)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  const contentWidth = Math.min(width - 24, layout.maxContentWidth)
  const isGeneral = selectedId === GENERAL_AGENT_ID
  const listData = useMemo(() => [...messages].reverse(), [messages])

  const selectedName = isGeneral
    ? 'עוזר כללי'
    : (agents.find((a) => a.id === selectedId)?.name ?? 'סוכן')

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        !isGeneral ? (
          <Pressable
            onPress={() => router.push(`/agent/${selectedId}` as Href)}
            hitSlop={10}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="הגדרות סוכן"
          >
            <Text style={styles.headerIcon}>⚙️</Text>
          </Pressable>
        ) : undefined,
    })
  }, [navigation, router, selectedId, isGeneral])

  useEffect(() => {
    if (!token) return
    fetchAgents(token)
      .then(({ agents: list, engine: eng }) => {
        setAgents(list)
        setEngine(eng)
      })
      .catch(() => {
        // Agent list is optional for general chat.
      })
  }, [token])

  useEffect(() => {
    let cancelled = false
    async function initSelection() {
      if (agentParam?.trim()) {
        setSelectedId(agentParam.trim())
        await storage.setItem(SELECTED_AGENT_KEY, agentParam.trim())
        return
      }
      const saved = await storage.getItem(SELECTED_AGENT_KEY)
      if (!cancelled && saved) setSelectedId(saved)
    }
    void initSelection()
    return () => {
      cancelled = true
    }
  }, [agentParam])

  const onSelectAgent = async (id: string) => {
    setSelectedId(id)
    await storage.setItem(SELECTED_AGENT_KEY, id)
  }

  const loadHistory = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const rows = isGeneral
        ? await fetchChatHistory(token)
        : await fetchAgentHistory(token, selectedId)
      setMessages(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינת היסטוריה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [token, selectedId, isGeneral])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const shown = Keyboard.addListener(show, (e) => {
      setKeyboardHeight(e.endCoordinates.height)
    })
    const hidden = Keyboard.addListener(hide, () => setKeyboardHeight(0))
    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])

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

  const pendingDeepLinkIndex = (() => {
    if (!messageParam || deepLinkHandled.current === messageParam) return null
    const index = listData.findIndex((m) => m.id === messageParam)
    return index >= 0 ? index : null
  })()

  const settleDeepLink = useCallback(() => {
    if (pendingDeepLinkIndex == null || !messageParam) return
    deepLinkHandled.current = messageParam
    listRef.current?.scrollToIndex({
      index: pendingDeepLinkIndex,
      animated: true,
      viewPosition: 0.5,
    })
  }, [messageParam, pendingDeepLinkIndex])

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
    setMessages((prev) => [
      ...prev,
      optimistic,
      { id: 'typing', role: 'typing', content: '', createdAt: '' },
    ])

    try {
      const assistant: Row = isGeneral
        ? await sendChatMessage(token, text).then(({ assistantMessage }) => ({
            id: `assistant-${Date.now()}`,
            role: 'assistant' as const,
            content: assistantMessage,
            createdAt: new Date().toISOString(),
          }))
        : await sendAgentMessage(token, selectedId, text).then(
            ({ assistantMessage, engine: eng }) => {
              setEngine(eng)
              return {
                id: `assistant-${Date.now()}`,
                role: 'assistant' as const,
                content: assistantMessage,
                createdAt: new Date().toISOString(),
              }
            },
          )

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
    const isLinked = !!messageParam && item.id === messageParam
    return (
      <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
        <View
          style={[
            styles.bubble,
            isUser ? styles.bubbleUser : styles.bubbleAssistant,
            isLinked && styles.bubbleLinked,
            { maxWidth: contentWidth * 0.85 },
          ]}
        >
          <Text style={styles.messageText}>{item.content}</Text>
        </View>
      </View>
    )
  }

  useEffect(() => {
    if (keyboardHeight === 0) restingWindowHeight.current = windowHeight
  }, [windowHeight, keyboardHeight])

  const windowShrink = Math.max(0, restingWindowHeight.current - windowHeight)
  const liftForKeyboard = composerLiftPx(keyboardHeight, windowShrink)
  const composerPad = keyboardHeight > 0 ? 8 : Math.max(insets.bottom, 8)

  return (
    <View style={[styles.flex, liftForKeyboard > 0 ? { paddingBottom: liftForKeyboard } : null]}>
      <Pressable
        style={styles.agentBar}
        onPress={() => setPickerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="בחר עוזר"
      >
        <Text style={styles.agentBarText}>
          מדבר עם {selectedName} · {engine}
        </Text>
        <Text style={styles.agentBarChevron}>▾</Text>
      </Pressable>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          key={selectedId}
          ref={listRef}
          inverted
          data={listData}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={settleDeepLink}
          onLayout={settleDeepLink}
          onScrollToIndexFailed={({ index }) => {
            listRef.current?.scrollToOffset({ offset: index * 96, animated: false })
            setTimeout(() => {
              listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 })
            }, 80)
          }}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {pushNotice ? (
        <Pressable onPress={() => router.push('/settings/developer' as Href)}>
          <Text style={styles.pushNotice}>{pushNotice}</Text>
        </Pressable>
      ) : null}

      <View style={[styles.composer, { paddingBottom: composerPad }]}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={isGeneral ? 'כתוב לראש מטה...' : 'כתוב לסוכן...'}
          placeholderTextColor={colors.textMuted}
          multiline
          textAlign="right"
          editable={!sending}
        />
        <Pressable
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
          onPress={() => void onSend()}
          disabled={!input.trim() || sending}
        >
          <Text style={styles.sendText}>שלח</Text>
        </Pressable>
      </View>

      <AgentPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        agents={agents}
        selectedId={selectedId}
        onSelect={(id) => void onSelectAgent(id)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBtn: { paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' },
  headerIcon: { fontSize: 20 },
  agentBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 44,
  },
  agentBarText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'right',
    writingDirection: 'rtl',
    flex: 1,
  },
  agentBarChevron: { color: colors.textMuted, fontSize: 14, paddingHorizontal: 4 },
  list: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexGrow: 1,
  },
  row: {
    marginBottom: 10,
    flexDirection: 'row',
  },
  rowUser: { justifyContent: 'flex-end' },
  rowAssistant: { justifyContent: 'flex-start' },
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
  bubbleLinked: {
    borderWidth: 1.5,
    borderColor: colors.accent,
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
  sendBtnDisabled: { opacity: 0.4 },
  sendText: { color: colors.bg, fontWeight: '600', fontSize: 15 },
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
