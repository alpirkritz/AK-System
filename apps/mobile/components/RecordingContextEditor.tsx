/**
 * Shared context editor for voice recording screens.
 * Lets the user pick attendees and a project before uploading a recording.
 * Used on record.tsx (live recording review) and import-recording.tsx (file import review).
 * See docs/specs/recording-context-before-upload.md.
 */

import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { type MobileProject } from '../lib/data'
import { colors } from '../lib/theme'

type Named = { id: string; name: string }
type PickerMode = { kind: 'person'; replaceId?: string } | { kind: 'project' }

export function RecordingContextEditor({
  people,
  project,
  directory,
  onChangePeople,
  onChangeProject,
}: {
  people: Named[]
  project: Named | null
  directory: { people: Named[]; projects: MobileProject[] } | null
  onChangePeople: (next: Named[]) => void
  onChangeProject: (next: Named | null) => void
}) {
  const [mode, setMode] = useState<PickerMode | null>(null)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const personMatches = !directory || mode?.kind !== 'person'
    ? []
    : directory.people.filter((p) => !people.some((x) => x.id === p.id) && p.name.toLowerCase().includes(q)).slice(0, 6)
  const projectMatches = !directory || mode?.kind !== 'project'
    ? []
    : directory.projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6)

  const open = (next: PickerMode) => {
    setMode(next)
    setQuery('')
  }
  const pickPerson = (person: Named) => {
    if (mode?.kind === 'person' && mode.replaceId) {
      onChangePeople(people.map((p) => (p.id === mode.replaceId ? person : p)))
    } else {
      onChangePeople([...people, person])
    }
    setMode(null)
    setQuery('')
  }
  const pickProject = (next: Named) => {
    onChangeProject(next)
    setMode(null)
    setQuery('')
  }

  return (
    <View style={styles.block}>
      <Text style={styles.sectionLabel}>משתתפים</Text>
      {people.length === 0 ? <Text style={styles.muted}>עדיין אין משתתפים</Text> : null}
      {people.map((p) => (
        <View key={p.id} style={styles.itemRow}>
          <Text style={[styles.body, styles.itemName]} numberOfLines={1}>{p.name}</Text>
          <Pressable onPress={() => open({ kind: 'person', replaceId: p.id })} hitSlop={8} accessibilityRole="button" accessibilityLabel={`ערוך את ${p.name}`}>
            <Text style={styles.linkBtn}>ערוך</Text>
          </Pressable>
          <Pressable onPress={() => onChangePeople(people.filter((x) => x.id !== p.id))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`הסר את ${p.name}`}>
            <Text style={styles.removeBtn}>הסר</Text>
          </Pressable>
        </View>
      ))}
      <Pressable onPress={() => open({ kind: 'person' })} accessibilityRole="button">
        <Text style={styles.link}>הוסף משתתף</Text>
      </Pressable>

      <Text style={styles.sectionLabel}>פרויקט</Text>
      {project ? (
        <View style={styles.itemRow}>
          <Text style={[styles.body, styles.itemName]} numberOfLines={1}>{project.name}</Text>
          <Pressable onPress={() => open({ kind: 'project' })} hitSlop={8} accessibilityRole="button" accessibilityLabel={`ערוך את ${project.name}`}>
            <Text style={styles.linkBtn}>ערוך</Text>
          </Pressable>
          <Pressable onPress={() => onChangeProject(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`הסר את ${project.name}`}>
            <Text style={styles.removeBtn}>הסר</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => open({ kind: 'project' })} accessibilityRole="button">
          <Text style={styles.link}>הוסף פרויקט</Text>
        </Pressable>
      )}

      {mode ? (
        <View style={styles.block}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={mode.kind === 'person' ? 'חפש אדם' : 'חפש פרויקט'}
            placeholderTextColor={colors.textMuted}
            style={styles.search}
            textAlign="right"
            autoFocus
            autoCorrect={false}
          />
          {(mode.kind === 'person' ? personMatches : projectMatches).map((item) => (
            <Pressable
              key={item.id}
              style={styles.match}
              onPress={() => (mode.kind === 'person' ? pickPerson(item) : pickProject(item))}
              accessibilityRole="button"
            >
              <Text style={styles.body}>{item.name}</Text>
            </Pressable>
          ))}
          {q && (mode.kind === 'person' ? personMatches : projectMatches).length === 0 ? (
            <Text style={styles.muted}>אין תוצאות</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const rtl = { textAlign: 'right' as const, writingDirection: 'rtl' as const }

const styles = StyleSheet.create({
  block: { gap: 8 },
  body: { color: colors.text, fontSize: 15, lineHeight: 22, ...rtl },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 19, ...rtl },
  sectionLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600', ...rtl },
  link: { color: colors.accent, fontSize: 14, fontWeight: '600', paddingVertical: 10, ...rtl },
  itemRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, minHeight: 44 },
  itemName: { flex: 1 },
  linkBtn: { color: colors.accent, fontSize: 14, fontWeight: '600', paddingVertical: 8 },
  removeBtn: { color: colors.error, fontSize: 14, fontWeight: '600', paddingVertical: 8 },
  search: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: colors.text,
    backgroundColor: colors.surface,
    writingDirection: 'rtl',
  },
  match: { minHeight: 44, justifyContent: 'center' },
})
