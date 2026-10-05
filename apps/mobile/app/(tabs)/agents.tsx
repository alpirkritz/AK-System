import { useFocusEffect, useRouter, type Href } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ListRow } from '../../components/ListRow'
import { useAuth } from '../../lib/auth'
import { fetchAgentConfigs } from '../../lib/data'
import { colors } from '../../lib/theme'

export default function AgentsScreen() {
  const { token } = useAuth()
  const router = useRouter()
  const [agents, setAgents] = useState<
    Array<{ agentId: string; name: string; role: string; enabled: boolean }>
  >([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedOnce = useRef(false)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return
      mode === 'refresh' ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        const res = await fetchAgentConfigs(token)
        setAgents(res.agents)
        hasLoadedOnce.current = true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'טעינה נכשלה')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [token],
  )

  useFocusEffect(
    useCallback(() => {
      if (!token) return
      void load(hasLoadedOnce.current ? 'refresh' : 'initial')
    }, [token, load]),
  )

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.accent} />
      }
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.group}>
        {agents.length === 0 ? (
          <Text style={styles.empty}>אין סוכנים</Text>
        ) : (
          agents.map((a) => (
            <ListRow
              key={a.agentId}
              icon="🤖"
              label={a.name}
              subtitle={a.role}
              value={a.enabled ? 'פעיל' : 'כבוי'}
              onPress={() => router.push(`/agent/${a.agentId}` as Href)}
              accessibilityLabel={`הגדרות ${a.name}`}
            />
          ))
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  group: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    padding: 24,
    writingDirection: 'rtl',
  },
  error: {
    color: colors.error,
    textAlign: 'center',
    paddingBottom: 12,
    writingDirection: 'rtl',
  },
})
