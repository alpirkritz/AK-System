import { useRouter, type Href } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ListRow } from '../components/ListRow'
import { useAuth } from '../lib/auth'
import { fetchAgentConfigs } from '../lib/data'
import { colors } from '../lib/theme'

export default function AgentsScreen() {
  const { token } = useAuth()
  const router = useRouter()
  const [agents, setAgents] = useState<
    Array<{ agentId: string; name: string; role: string; enabled: boolean }>
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetchAgentConfigs(token)
      setAgents(res.agents)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
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
