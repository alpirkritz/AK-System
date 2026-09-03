/**
 * Conversation Analysis component for meeting detail page
 * Displays deep qualitative analysis from transcripts
 */

'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'

interface ConversationAnalysisProps {
  meetingId: string
}

export function ConversationAnalysis({ meetingId }: ConversationAnalysisProps) {
  const [showTranscript, setShowTranscript] = useState(false)

  const { data: analysis, isLoading, refetch } = trpc.meetings.getAnalysis.useQuery({ meetingId })
  
  const analyzeMutation = trpc.meetings.analyzeTranscript.useMutation({
    onSuccess: () => {
      refetch()
    },
  })

  const createTasksMutation = trpc.meetings.createTasksFromAnalysis.useMutation({
    onSuccess: () => {
      refetch()
    },
  })

  const handleAnalyze = () => {
    analyzeMutation.mutate({ meetingId, force: false })
  }

  const handleCreateTask = (index: number) => {
    if (!analysis) return
    createTasksMutation.mutate({
      analysisId: analysis.id,
      indices: [index],
    })
  }

  const handleCreateAllTasks = () => {
    if (!analysis) return
    createTasksMutation.mutate({
      analysisId: analysis.id,
    })
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-teal-500"></div>
          <span className="text-sm text-gray-600 dark:text-gray-400">טוען ניתוח...</span>
        </div>
      </div>
    )
  }

  if (!analysis && !analyzeMutation.isPending) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            ניתוח שיחה
          </h3>
          <button
            onClick={handleAnalyze}
            disabled={analyzeMutation.isPending}
            className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {analyzeMutation.isPending ? 'מנתח...' : 'נתח שיחה'}
          </button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          לחץ על &quot;נתח שיחה&quot; לקבלת ניתוח מעמיק של השיחה - מצב רוח, תת-טקסט, תובנות וקאיזן
        </p>
      </div>
    )
  }

  if (analyzeMutation.isPending || analysis?.status === 'pending') {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-teal-500"></div>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            מנתח את התמלול... (10-15 שניות)
          </span>
        </div>
      </div>
    )
  }

  if (analysis?.status === 'failed') {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-red-900 dark:text-red-100 mb-2">
              הניתוח נכשל
            </h3>
            <p className="text-sm text-red-700 dark:text-red-300">{analysis.error}</p>
          </div>
          <button
            onClick={handleAnalyze}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium"
          >
            נסה שוב
          </button>
        </div>
      </div>
    )
  }

  if (!analysis || analysis.status !== 'completed') {
    return null
  }

  const hasUnassignedTasks = analysis.actionItems.some((item) => !item.taskId)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              ניתוח שיחה
            </h3>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200">
              {analysis.hatName}
            </span>
          </div>
          <button
            onClick={() => handleAnalyze()}
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            נתח מחדש
          </button>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-4">
            {/* Topic */}
            <div>
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                נושא
              </div>
              <div className="text-base text-gray-900 dark:text-gray-100 font-medium">
                {analysis.topic}
              </div>
            </div>

            {/* Mood */}
            <div>
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                🎭 אווירה
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300">
                {analysis.mood}
              </div>
            </div>

            {/* Subtext */}
            <div>
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                🕵️ סאב-טקסט
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300 italic">
                {analysis.subtext}
              </div>
            </div>

            {/* Key Insight */}
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4">
              <div className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-2">
                💡 תובנה מרכזית
              </div>
              <div className="text-sm text-amber-800 dark:text-amber-200">
                {analysis.keyInsight}
              </div>
            </div>

            {/* Score */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl font-bold text-teal-600 dark:text-teal-400">
                  {analysis.score}/10
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">מדד איכות</span>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {analysis.scoreRationale}
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-4">
            {/* Participants */}
            {analysis.participants.length > 0 && (
              <div>
                <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                  👥 משתתפים
                </div>
                <div className="flex flex-wrap gap-2">
                  {analysis.participants.map((p, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center px-3 py-1 rounded-full text-xs ${
                        p.confirmed
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {p.confirmed ? '✓' : '?'} {p.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Kaizen */}
            <div className="space-y-3">
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                📈 קאיזן
              </div>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <span className="text-green-600 dark:text-green-400 flex-shrink-0">✓</span>
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    <span className="font-medium">לשימור:</span> {analysis.kaizenKeep}
                  </div>
                </div>
                <div className="flex gap-2">
                  <span className="text-blue-600 dark:text-blue-400 flex-shrink-0">→</span>
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    <span className="font-medium">לשיפור:</span> {analysis.kaizenImprove}
                  </div>
                </div>
              </div>
            </div>

            {/* Open Question */}
            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4">
              <div className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                ❓ שאלה למחשבה
              </div>
              <div className="text-sm text-blue-800 dark:text-blue-200">
                {analysis.openQuestion}
              </div>
            </div>
          </div>
        </div>

        {/* Action Items */}
        {analysis.actionItems.length > 0 && (
          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                ✅ אקשן אייטמס
              </h4>
              {hasUnassignedTasks && (
                <button
                  onClick={handleCreateAllTasks}
                  disabled={createTasksMutation.isPending}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  צור הכל
                </button>
              )}
            </div>
            <div className="space-y-3">
              {analysis.actionItems.map((item, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50"
                >
                  <span className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                    •
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      {item.content}
                    </div>
                    {item.owner && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {item.owner}
                      </div>
                    )}
                  </div>
                  {!item.taskId ? (
                    <button
                      onClick={() => handleCreateTask(index)}
                      disabled={createTasksMutation.isPending}
                      className="px-3 py-1 bg-teal-500 hover:bg-teal-600 text-white rounded text-xs font-medium transition-colors disabled:opacity-50 flex-shrink-0"
                    >
                      צור משימה
                    </button>
                  ) : (
                    <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                      ✓ נוצר
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Transcript Toggle */}
        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setShowTranscript(!showTranscript)}
            className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 font-medium"
          >
            {showTranscript ? '▼' : '▶'} תמלול מלא
          </button>
          {showTranscript && (
            <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 max-h-96 overflow-y-auto">
              <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
                {/* Note: Transcript would be fetched separately in production */}
                התמלול יוצג כאן
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
