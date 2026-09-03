import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { colors, PRIORITY_COLOR, PRIORITY_LABEL } from '../lib/theme'
import { useState, useEffect } from 'react'
import { createTrpcClient } from '../lib/trpc'
import { useAuth } from '../lib/auth'

// Copy of the helper from packages/api - keep in sync
function derivePriorityFromContext(content: string): 'high' | 'medium' | 'low' {
  const lower = content.toLowerCase()
  const urgentKeywords = [
    'דחוף',
    'urgent',
    'asap',
    'היום',
    'עכשיו',
    'מיידי',
    'critical',
    'today',
    'now',
    'immediately',
  ]
  return urgentKeywords.some((kw) => lower.includes(kw)) ? 'high' : 'medium'
}

type ActionItem = {
  content: string
  owner?: string
  taskId?: string
}

interface BatchTaskItem {
  index: number
  title: string
  priority: 'high' | 'medium' | 'low'
  dueDate: string
  included: boolean
}

type Props = {
  visible: boolean
  onClose: () => void
  analysisId: string
  actionItems: ActionItem[]
  meetingId: string
  meetingDate?: string
  projectId?: string | null
  onSaved?: () => void
}

export function BatchTaskModal({
  visible,
  onClose,
  analysisId,
  actionItems,
  meetingId,
  meetingDate,
  projectId,
  onSaved,
}: Props) {
  const { token } = useAuth()
  const [items, setItems] = useState<BatchTaskItem[]>([])
  const [saving, setSaving] = useState(false)

  // Initialize items from unassigned action items
  useEffect(() => {
    if (!visible) return
    const unassigned = actionItems
      .map((item, index) => ({ ...item, index }))
      .filter((item) => !item.taskId)

    setItems(
      unassigned.map((item) => ({
        index: item.index,
        title: item.content,
        priority: derivePriorityFromContext(item.content),
        dueDate: meetingDate ?? '',
        included: true,
      }))
    )
  }, [visible, actionItems, meetingDate])

  const updateItem = (index: number, updates: Partial<BatchTaskItem>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...updates } : item)))
  }

  const toggleIncluded = (index: number) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, included: !item.included } : item))
    )
  }

  const handleSave = async () => {
    if (!token) return
    const toCreate = items.filter((item) => item.included && item.title.trim())
    if (toCreate.length === 0) {
      onClose()
      return
    }

    setSaving(true)
    try {
      const client = createTrpcClient(token)

      for (const item of toCreate) {
        await client.tasks.create.mutate({
          title: item.title.trim(),
          meetingId: meetingId || null,
          projectId: projectId || null,
          workspaceId: null,
          assigneeId: null,
          dueDate: item.dueDate || null,
          priority: item.priority,
          status: 'not_started',
        })
      }

      onSaved?.()
      onClose()
    } catch (error) {
      console.error('[BatchTaskModal] Save failed:', error)
    } finally {
      setSaving(false)
    }
  }

  const includedCount = items.filter((item) => item.included).length

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>צור משימות מאקשן אייטמס</Text>
          <Text style={styles.subtitle}>{items.length} פריטים</Text>

          {items.length === 0 ? (
            <Text style={styles.emptyText}>כל האקשן אייטמס כבר הומרו למשימות</Text>
          ) : (
            <>
              <FlatList
                data={items}
                keyExtractor={(_, idx) => idx.toString()}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                renderItem={({ item, index: idx }) => (
                  <View
                    style={[
                      styles.item,
                      item.included && styles.itemIncluded,
                    ]}
                  >
                    <View style={styles.itemHeader}>
                      <Pressable
                        onPress={() => toggleIncluded(idx)}
                        style={styles.checkbox}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: item.included }}
                      >
                        <View
                          style={[
                            styles.checkboxBox,
                            item.included && styles.checkboxBoxChecked,
                          ]}
                        >
                          {item.included && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                      </Pressable>
                    </View>

                    <View style={styles.itemBody}>
                      <TextInput
                        value={item.title}
                        onChangeText={(text) => updateItem(idx, { title: text })}
                        placeholder="כותרת המשימה"
                        placeholderTextColor={colors.textMuted}
                        style={[styles.input, !item.included && styles.inputDisabled]}
                        editable={item.included}
                        multiline
                        textAlign="right"
                      />

                      <Text style={styles.label}>עדיפות</Text>
                      <View style={styles.priorities}>
                        {(['high', 'medium', 'low'] as const).map((p) => (
                          <Pressable
                            key={p}
                            onPress={() => updateItem(idx, { priority: p })}
                            disabled={!item.included}
                            style={[
                              styles.priorityChip,
                              item.priority === p && {
                                borderColor: PRIORITY_COLOR[p],
                                backgroundColor: PRIORITY_COLOR[p] + '22',
                              },
                              !item.included && styles.chipDisabled,
                            ]}
                          >
                            <Text
                              style={[
                                styles.priorityText,
                                item.priority === p && {
                                  color: PRIORITY_COLOR[p],
                                  fontWeight: '600',
                                },
                              ]}
                            >
                              {PRIORITY_LABEL[p]}
                            </Text>
                          </Pressable>
                        ))}
                      </View>

                      {item.dueDate && (
                        <Text style={styles.dateText}>
                          {new Date(item.dueDate).toLocaleDateString('he-IL')}
                        </Text>
                      )}
                    </View>
                  </View>
                )}
              />

              <View style={styles.footer}>
                <Pressable
                  onPress={onClose}
                  disabled={saving}
                  style={styles.cancelButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.cancelButtonText}>ביטול</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleSave()}
                  disabled={saving || includedCount === 0}
                  style={[
                    styles.saveButton,
                    (saving || includedCount === 0) && styles.saveButtonDisabled,
                  ]}
                  accessibilityRole="button"
                >
                  {saving ? (
                    <ActivityIndicator color={colors.bg} />
                  ) : (
                    <Text style={styles.saveButtonText}>צור {includedCount} משימות</Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#00000099',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: colors.surfaceCard,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '90%',
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: 4,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: 16,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    writingDirection: 'rtl',
    paddingVertical: 32,
  },
  list: {
    maxHeight: '70%',
  },
  listContent: {
    gap: 12,
  },
  item: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
  },
  itemIncluded: {
    borderColor: colors.accent + '55',
    backgroundColor: colors.accent + '11',
  },
  itemHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginBottom: 8,
  },
  checkbox: {
    padding: 4,
  },
  checkboxBox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxBoxChecked: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  checkmark: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: '700',
  },
  itemBody: {
    gap: 8,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
    writingDirection: 'rtl',
    minHeight: 44,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  priorities: {
    flexDirection: 'row-reverse',
    gap: 8,
  },
  priorityChip: {
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  chipDisabled: {
    opacity: 0.4,
  },
  priorityText: {
    color: colors.textMuted,
    fontSize: 13,
    writingDirection: 'rtl',
  },
  dateText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  footer: {
    flexDirection: 'row-reverse',
    gap: 12,
    marginTop: 16,
  },
  cancelButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.45,
  },
  saveButtonText: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: '700',
  },
})
