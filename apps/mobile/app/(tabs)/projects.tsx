import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { useAuth } from '../lib/auth'
import { createProject, fetchProjects, type MobileProject } from '../lib/data'
import { colors } from '../lib/theme'

export default function ProjectsScreen() {
  const { token } = useAuth()
  const router = useRouter()
  const [projects, setProjects] = useState<MobileProject[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return
      mode === 'refresh' ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        setProjects(await fetchProjects(token))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'טעינת הפרויקטים נכשלה')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [token],
  )

  useEffect(() => {
    void load()
  }, [load])

  const onCreate = async () => {
    if (!token || creating) return
    const trimmed = newName.trim()
    if (!trimmed) return
    setCreating(true)
    setError(null)
    try {
      const project = await createProject(token, { name: trimmed })
      setNewName('')
      router.push(`/project/${project.id}` as Href)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'יצירה נכשלה')
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <View style={styles.flex}>
      <View style={styles.createRow}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          placeholder="שם פרויקט חדש…"
          placeholderTextColor={colors.textMuted}
          style={styles.createInput}
          textAlign="right"
          returnKeyType="done"
          onSubmitEditing={() => void onCreate()}
        />
        <Pressable
          onPress={() => void onCreate()}
          disabled={creating || !newName.trim()}
          style={[styles.createBtn, (creating || !newName.trim()) && styles.createBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="צור פרויקט"
        >
          <Text style={styles.createBtnText}>{creating ? '…' : '+'}</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={projects}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.accent} />
        }
        ListEmptyComponent={<EmptyState icon="📁" text="אין פרויקטים עדיין" />}
        renderItem={({ item }) => (
          <Card
            style={styles.card}
            onPress={() => router.push(`/project/${item.id}` as Href)}
            accessibilityLabel={`פרויקט ${item.name}`}
          >
            <View style={styles.cardInner}>
              {item.color ? (
                <View style={[styles.dot, { backgroundColor: item.color }]} />
              ) : null}
              <View style={styles.cardBody}>
                <Text style={styles.name}>{item.name}</Text>
                {item.description ? (
                  <Text style={styles.desc} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
            </View>
          </Card>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  createRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  createInput: {
    flex: 1,
    backgroundColor: colors.surfaceCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  createBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnDisabled: { opacity: 0.45 },
  createBtnText: { color: colors.bg, fontSize: 24, fontWeight: '400', lineHeight: 28 },
  list: { paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 },
  card: { marginBottom: 8 },
  cardInner: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cardBody: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'right', writingDirection: 'rtl' },
  desc: { color: colors.textMuted, fontSize: 13, textAlign: 'right', marginTop: 4 },
  error: { color: colors.error, textAlign: 'center', padding: 8, writingDirection: 'rtl' },
})
