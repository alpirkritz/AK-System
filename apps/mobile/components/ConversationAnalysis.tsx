import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../lib/theme'
import { createTrpcClient } from '../lib/trpc'
import { useAuth } from '../lib/auth'
import { useState, useEffect } from 'react'
import { useRouter } from 'expo-router'
import { BatchTaskModal } from './BatchTaskModal'

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

type AnalysisParticipant = {
  name: string
  confirmed: boolean
}

type AnalysisActionItem = {
  content: string
  owner?: string
  taskId?: string
}

type Analysis = {
  id: string
  hatName: string | null
  topic: string | null
  mood: string | null
  subtext: string | null
  keyInsight: string | null
  score: number | null
  scoreRationale: string | null
  kaizenKeep: string | null
  kaizenImprove: string | null
  openQuestion: string | null
  participants: AnalysisParticipant[]
  actionItems: AnalysisActionItem[]
  status: 'pending' | 'completed' | 'failed' | string
  error: string | null
  createdAt: string
}

type Props = {
  meetingId: string
}

export function ConversationAnalysis({ meetingId }: Props) {
  const { token } = useAuth()
  const router = useRouter()
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [meeting, setMeeting] = useState<{ date?: string; projectId?: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [batchModalVisible, setBatchModalVisible] = useState(false)

  const loadAnalysis = async () => {
    if (!token) return
    setLoading(true)
    try {
      const client = createTrpcClient(token)
      const [analysisResult, meetingResult] = await Promise.all([
        client.meetings.getAnalysis.query({ meetingId }),
        client.meetings.getById.query({ id: meetingId }).catch(() => null),
      ])
      setAnalysis(analysisResult)
      setMeeting(meetingResult)
    } catch (err) {
      console.error('[ConversationAnalysis] Load failed:', err)
      const errorMessage = err instanceof Error ? err.message : 'שגיאת רשת'
      Alert.alert('שגיאה בטעינת ניתוח', `לא הצלחנו לטעון את הניתוח: ${errorMessage}`, [
        { text: 'ביטול', style: 'cancel' },
        { text: 'נסה שוב', onPress: () => void loadAnalysis() },
      ])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAnalysis()
  }, [meetingId, token])

  const handleAnalyze = async () => {
    if (!token || analyzing) return
    setAnalyzing(true)
    try {
      const client = createTrpcClient(token)
      await client.meetings.analyzeTranscript.mutate({ meetingId, force: false })
      // Poll for completion
      setTimeout(() => void loadAnalysis(), 2000)
    } catch (err) {
      console.error('[ConversationAnalysis] Analyze failed:', err)
    } finally {
      setAnalyzing(false)
    }
  }

  const handleCreateTask = async (index: number) => {
    if (!analysis) return
    const item = analysis.actionItems[index]
    const priority = derivePriorityFromContext(item.content)

    // Match person by name (simple client-side matching)
    // In a production app, this could be done via a tRPC query
    const params: Record<string, string> = {
      title: item.content,
      priority,
      meetingId,
    }
    
    if (meeting?.date) params.dueDate = meeting.date
    if (meeting?.projectId) params.projectId = meeting.projectId
    // assigneeId would require fetching people list; skip for now

    router.push({
      pathname: '/task/new' as any,
      params,
    })
  }

  const handleCreateAllTasks = () => {
    if (!analysis) return
    setBatchModalVisible(true)
  }

  const handleBatchSaved = async () => {
    setBatchModalVisible(false)
    await loadAnalysis()
  }

  // Loading state
  if (loading) {
    return (
      <View style={styles.card}>
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>טוען ניתוח...</Text>
        </View>
      </View>
    )
  }

  // No analysis + not analyzing
  if (!analysis && !analyzing) {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>ניתוח שיחה</Text>
        </View>
        <Text style={styles.description}>
          ניתוח מעמיק של השיחה: מצב רוח, תובנות, קאיזן ואקשן אייטמס
        </Text>
        <Pressable
          onPress={() => void handleAnalyze()}
          disabled={analyzing}
          style={styles.primaryButton}
          accessibilityRole="button"
          accessibilityLabel="נתח שיחה"
        >
          <Text style={styles.primaryButtonText}>נתח שיחה</Text>
        </Pressable>
      </View>
    )
  }

  // Pending state
  if (analyzing || analysis?.status === 'pending') {
    return (
      <View style={styles.card}>
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>מנתח את התמלול... (10-15 שניות)</Text>
        </View>
      </View>
    )
  }

  // Failed state
  if (analysis?.status === 'failed') {
    return (
      <View style={[styles.card, styles.errorCard]}>
        <Text style={styles.errorTitle}>הניתוח נכשל</Text>
        <Text style={styles.errorText}>{analysis.error}</Text>
        <Pressable
          onPress={() => void handleAnalyze()}
          style={styles.retryButton}
          accessibilityRole="button"
          accessibilityLabel="נסה שוב"
        >
          <Text style={styles.retryButtonText}>נסה שוב</Text>
        </Pressable>
      </View>
    )
  }

  // Completed state
  if (!analysis || analysis.status !== 'completed') {
    return null
  }

  const hasUnassignedTasks = analysis.actionItems.some(item => !item.taskId)

  return (
    <View style={styles.container}>
      {/* Header with hat badge and refresh */}
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>ניתוח שיחה</Text>
            {analysis.hatName && (
              <View style={styles.hatBadge}>
                <Text style={styles.hatText}>{analysis.hatName}</Text>
              </View>
            )}
          </View>
          <Pressable
            onPress={() => void loadAnalysis()}
            disabled={loading}
            style={styles.refreshButton}
            accessibilityRole="button"
            accessibilityLabel="רענן ניתוח"
          >
            <Text style={styles.refreshIcon}>🔄</Text>
          </Pressable>
        </View>
      </View>

      {/* Main fields */}
      <View style={styles.card}>
        <View style={styles.fieldsContainer}>
          {analysis.topic && (
            <View style={styles.field}>
              <Text style={styles.label}>נושא</Text>
              <Text style={styles.value}>{analysis.topic}</Text>
            </View>
          )}

          {analysis.mood && (
            <View style={styles.field}>
              <Text style={styles.label}>אווירה</Text>
              <Text style={styles.value}>{analysis.mood}</Text>
            </View>
          )}

          {analysis.subtext && (
            <View style={styles.field}>
              <Text style={styles.label}>סאב-טקסט</Text>
              <Text style={[styles.value, styles.italic]}>{analysis.subtext}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Key Insight - Amber callout */}
      {analysis.keyInsight && (
        <View style={[styles.callout, styles.amberCallout]}>
          <Text style={styles.calloutTitle}>💡 תובנה מרכזית</Text>
          <Text style={styles.calloutText}>{analysis.keyInsight}</Text>
        </View>
      )}

      {/* Score */}
      {analysis.score !== null && (
        <View style={styles.card}>
          <Text style={styles.label}>מדד איכות</Text>
          <Text style={styles.scoreValue}>{analysis.score}/10</Text>
          {analysis.scoreRationale && (
            <Text style={styles.value}>{analysis.scoreRationale}</Text>
          )}
        </View>
      )}

      {/* Participants */}
      {analysis.participants.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.label}>משתתפים</Text>
          <View style={styles.chipRow}>
            {analysis.participants.map((p, i) => (
              <View key={i} style={styles.participantChip}>
                <Text style={styles.participantText}>
                  {p.confirmed ? '✓' : '?'} {p.name}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Kaizen */}
      {(analysis.kaizenKeep || analysis.kaizenImprove) && (
        <View style={styles.card}>
          <Text style={styles.label}>קאיזן - פידבק לצמיחה</Text>
          {analysis.kaizenKeep && (
            <View style={styles.kaizenRow}>
              <Text style={styles.kaizenIcon}>✓</Text>
              <View style={styles.kaizenContent}>
                <Text style={styles.kaizenLabel}>לשימור</Text>
                <Text style={styles.value}>{analysis.kaizenKeep}</Text>
              </View>
            </View>
          )}
          {analysis.kaizenImprove && (
            <View style={styles.kaizenRow}>
              <Text style={styles.kaizenIcon}>→</Text>
              <View style={styles.kaizenContent}>
                <Text style={styles.kaizenLabel}>לשיפור</Text>
                <Text style={styles.value}>{analysis.kaizenImprove}</Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Open Question - Blue callout */}
      {analysis.openQuestion && (
        <View style={[styles.callout, styles.blueCallout]}>
          <Text style={styles.calloutTitle}>❓ שאלה למחשבה</Text>
          <Text style={styles.calloutText}>{analysis.openQuestion}</Text>
        </View>
      )}

      {/* Action Items */}
      {analysis.actionItems.length > 0 && (
        <View style={styles.card}>
          <View style={styles.actionHeader}>
            <Text style={styles.label}>אקשן אייטמס</Text>
            {hasUnassignedTasks && (
              <Pressable
                onPress={() => void handleCreateAllTasks()}
                style={styles.secondaryButton}
                accessibilityRole="button"
                accessibilityLabel={`צור ${analysis.actionItems.filter(item => !item.taskId).length} משימות`}
              >
                <Text style={styles.secondaryButtonText}>
                  צור הכל ({analysis.actionItems.filter(item => !item.taskId).length})
                </Text>
              </Pressable>
            )}
          </View>
          {analysis.actionItems.map((item, index) => (
            <View key={index} style={styles.actionItem}>
              <View style={styles.actionContent}>
                <Text style={styles.actionText}>
                  • {item.content}
                  {item.owner && <Text style={styles.actionOwner}> ({item.owner})</Text>}
                </Text>
              </View>
              {item.taskId ? (
                <View style={styles.createdBadge}>
                  <Text style={styles.createdText}>✓ נוצר</Text>
                </View>
              ) : (
                <Pressable
                  onPress={() => void handleCreateTask(index)}
                  style={styles.createTaskButton}
                  accessibilityRole="button"
                  accessibilityLabel={`צור משימה: ${item.content}`}
                >
                  <Text style={styles.createTaskText}>צור משימה</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Batch Task Modal */}
      {analysis && (
        <BatchTaskModal
          visible={batchModalVisible}
          onClose={() => setBatchModalVisible(false)}
          analysisId={analysis.id}
          actionItems={analysis.actionItems}
          meetingId={meetingId}
          meetingDate={meeting?.date}
          projectId={meeting?.projectId ?? null}
          onSaved={handleBatchSaved}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
    paddingVertical: 16,
  },
  card: {
    backgroundColor: colors.surfaceCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 32,
  },
  errorCard: {
    borderColor: colors.coral + '66',
    backgroundColor: colors.coral + '11',
  },
  loadingRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 14,
    writingDirection: 'rtl',
  },
  header: {
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerLeft: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  refreshButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  refreshIcon: {
    fontSize: 18,
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
    writingDirection: 'rtl',
  },
  description: {
    color: colors.textMuted,
    fontSize: 14,
    writingDirection: 'rtl',
    marginBottom: 16,
    lineHeight: 20,
  },
  hatBadge: {
    backgroundColor: '#8b5cf6' + '22',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#8b5cf6' + '33',
  },
  hatText: {
    color: '#8b5cf6',
    fontSize: 12,
    fontWeight: '600',
    writingDirection: 'rtl',
  },
  fieldsContainer: {
    gap: 16,
  },
  field: {
    gap: 4,
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    writingDirection: 'rtl',
  },
  value: {
    color: colors.text,
    fontSize: 15,
    writingDirection: 'rtl',
    lineHeight: 22,
  },
  italic: {
    fontStyle: 'italic',
  },
  callout: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  amberCallout: {
    backgroundColor: '#f59e0b' + '11',
    borderColor: '#f59e0b',
  },
  blueCallout: {
    backgroundColor: '#38bdf8' + '11',
    borderColor: '#38bdf8',
  },
  calloutTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    writingDirection: 'rtl',
  },
  calloutText: {
    color: colors.text,
    fontSize: 14,
    writingDirection: 'rtl',
    lineHeight: 20,
  },
  scoreValue: {
    color: colors.accent,
    fontSize: 24,
    fontWeight: '700',
    writingDirection: 'rtl',
    marginVertical: 4,
  },
  chipRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  participantChip: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  participantText: {
    color: colors.text,
    fontSize: 13,
    writingDirection: 'rtl',
  },
  kaizenRow: {
    flexDirection: 'row-reverse',
    gap: 12,
    marginTop: 12,
  },
  kaizenIcon: {
    color: colors.accent,
    fontSize: 16,
  },
  kaizenContent: {
    flex: 1,
    gap: 4,
  },
  kaizenLabel: {
    color: colors.textMuted,
    fontSize: 12,
    writingDirection: 'rtl',
  },
  actionHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  actionItem: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionContent: {
    flex: 1,
  },
  actionText: {
    color: colors.text,
    fontSize: 14,
    writingDirection: 'rtl',
    lineHeight: 20,
  },
  actionOwner: {
    color: colors.textMuted,
    fontSize: 13,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  primaryButtonText: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: '600',
    writingDirection: 'rtl',
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    minHeight: 36,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
    writingDirection: 'rtl',
  },
  createTaskButton: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  createTaskText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
    writingDirection: 'rtl',
  },
  createdBadge: {
    backgroundColor: colors.success + '22',
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.success + '33',
  },
  createdText: {
    color: colors.success,
    fontSize: 14,
    fontWeight: '600',
    writingDirection: 'rtl',
  },
  errorTitle: {
    color: colors.coral,
    fontSize: 17,
    fontWeight: '600',
    writingDirection: 'rtl',
    marginBottom: 8,
  },
  errorText: {
    color: colors.coral,
    fontSize: 14,
    writingDirection: 'rtl',
    marginBottom: 16,
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: colors.coral,
    borderRadius: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  retryButtonText: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: '600',
    writingDirection: 'rtl',
  },
})
