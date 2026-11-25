/**
 * Conversation Analysis component for meeting detail page
 * Displays deep qualitative analysis from transcripts
 */

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { TaskModal } from '@/components/Modals/TaskModal'
import { BatchTaskModal } from '@/components/Modals/BatchTaskModal'
import { derivePriorityFromContext } from '@ak-system/api/lib/task-priority'
import { matchTaskAssigneeId } from '@ak-system/api/lib/self-identity'
import { AddPersonControl } from './AddPersonControl'
import { MeetingTranscript } from './MeetingTranscript'

interface ConversationAnalysisProps {
  meetingId: string
}

export function ConversationAnalysis({ meetingId }: ConversationAnalysisProps) {
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [selectedActionIndex, setSelectedActionIndex] = useState<number | null>(null)
  const [linkIndex, setLinkIndex] = useState<number | null>(null)
  const [linkQuery, setLinkQuery] = useState('')
  const [confirmRemoveIndex, setConfirmRemoveIndex] = useState<number | null>(null)
  const [peopleNotice, setPeopleNotice] = useState<string | null>(null)
  const [peopleError, setPeopleError] = useState<string | null>(null)

  const { data: analysis, isLoading, refetch } = trpc.meetings.getAnalysis.useQuery({ meetingId })
  const { data: meeting } = trpc.meetings.getById.useQuery({ id: meetingId })
  const { data: people = [] } = trpc.people.list.useQuery()
  const { data: meetings = [] } = trpc.meetings.list.useQuery()
  const { data: projects = [] } = trpc.projects.list.useQuery()
  const { data: workspaces = [] } = trpc.workspaces.list.useQuery()
  
  const analyzeMutation = trpc.meetings.analyzeTranscript.useMutation({
    onSettled: () => {
      void refetch()
    },
  })

  const utils = trpc.useUtils()

  function refreshPeople() {
    void refetch()
    void utils.meetings.getById.invalidate()
    void utils.meetings.list.invalidate()
    void utils.people.list.invalidate()
  }

  function peopleErrorText(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
      return error.message
    }
    return 'לא הצלחנו לעדכן את המשתתפים. נסה שוב.'
  }

  const acceptParticipant = trpc.meetings.acceptAnalysisParticipant.useMutation({
    onSuccess: (result) => {
      setPeopleError(null)
      setLinkIndex(null)
      setLinkQuery('')
      setPeopleNotice(
        result.created
          ? `${result.name} נוסף לפגישה ולאנשי הקשר`
          : `${result.name} נוסף לפגישה`,
      )
      refreshPeople()
    },
    onError: (error) => setPeopleError(peopleErrorText(error)),
  })

  const removeParticipant = trpc.meetings.removeAnalysisParticipant.useMutation({
    onSuccess: () => {
      setPeopleError(null)
      setConfirmRemoveIndex(null)
      setPeopleNotice('ההצעה הוסרה')
      refreshPeople()
    },
    onError: (error) => setPeopleError(peopleErrorText(error)),
  })

  const attachPerson = trpc.meetings.attachPerson.useMutation({
    onSuccess: (result) => {
      setPeopleError(null)
      setPeopleNotice(
        result.created
          ? `${result.name} נוסף לפגישה ולאנשי הקשר`
          : `${result.name} נוסף לפגישה`,
      )
      refreshPeople()
    },
    onError: (error) => setPeopleError(peopleErrorText(error)),
  })

  const linkActionItemMutation = trpc.meetings.linkActionItemTasks.useMutation({
    onSuccess: () => {
      refetch()
    },
  })

  const handleAnalyze = (force: boolean) => {
    analyzeMutation.mutate({ meetingId, force })
  }

  const analyzeErrorMessage =
    analyzeMutation.error instanceof Error
      ? analyzeMutation.error.message.replace(/^Analysis failed:\s*/i, '')
      : analyzeMutation.error
        ? String(analyzeMutation.error)
        : null

  const openTaskModal = (index: number) => {
    setSelectedActionIndex(index)
    setTaskModalOpen(true)
  }

  const closeTaskModal = () => {
    setTaskModalOpen(false)
    setSelectedActionIndex(null)
  }

  const handleTaskCreated = (notionSync: { ok: boolean } | null, task?: { id: string }) => {
    if (task && selectedActionIndex !== null && analysis) {
      linkActionItemMutation.mutate({
        analysisId: analysis.id,
        links: [{ actionItemIndex: selectedActionIndex, taskId: task.id }],
      })
    }
    closeTaskModal()
  }

  const handleBatchSaved = () => {
    refetch()
    setBatchModalOpen(false)
  }

  function matchPersonByName(ownerName: string | undefined): string {
    return matchTaskAssigneeId(ownerName, people)
  }

  const meetingPeopleIds: string[] = meeting?.peopleIds ?? []
  const peopleBusy = acceptParticipant.isPending || removeParticipant.isPending || attachPerson.isPending

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
            type="button"
            onClick={() => handleAnalyze(false)}
            disabled={analyzeMutation.isPending}
            className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {analyzeMutation.isPending ? 'מנתח...' : 'נתח שיחה'}
          </button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          לחץ על &quot;נתח שיחה&quot; לקבלת ניתוח מעמיק של השיחה - מצב רוח, תת-טקסט, תובנות וקאיזן
        </p>
        {analyzeErrorMessage ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{analyzeErrorMessage}</p>
        ) : null}
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
            type="button"
            onClick={() => handleAnalyze(true)}
            disabled={analyzeMutation.isPending}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
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
            type="button"
            onClick={() => handleAnalyze(true)}
            disabled={analyzeMutation.isPending}
            className="text-sm text-teal-600 hover:text-teal-500 dark:text-teal-400 dark:hover:text-teal-300 disabled:opacity-50"
          >
            נתח מחדש
          </button>
        </div>
        {analyzeErrorMessage ? (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400">{analyzeErrorMessage}</p>
        ) : null}

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

        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            {/* Participants */}
            <div>
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                👥 משתתפים מומלצים
              </div>
              {analysis.participants.length === 0 ? (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  הניתוח לא זיהה משתתפים. אפשר להוסיף אדם לפגישה.
                </p>
              ) : (
                <div className="space-y-2 mb-3">
                  {analysis.participants.map((p, i) => {
                    const linkedOnMeeting = people.filter(
                      (person) =>
                        meetingPeopleIds.includes(person.id) &&
                        person.name.trim().toLowerCase() === p.name.trim().toLowerCase(),
                    )
                    const onMeeting = Boolean(
                      (p.personId && meetingPeopleIds.includes(p.personId)) || linkedOnMeeting.length === 1,
                    )
                    const linking = linkIndex === i
                    const confirming = confirmRemoveIndex === i
                    const linkChoices = people.filter((person) =>
                      person.name.toLowerCase().includes(linkQuery.trim().toLowerCase()),
                    )
                    return (
                      <div key={`${p.name}-${i}`} className="rounded-lg bg-gray-50 dark:bg-gray-900/60 p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm text-gray-900 dark:text-gray-100 flex-1 min-w-[8rem]">
                            {onMeeting ? '✓' : '?'}{' '}
                            {p.personId && p.personName ? (
                              <Link
                                href={`/people?person=${p.personId}`}
                                className="text-teal-700 dark:text-teal-300 hover:underline"
                                data-testid="analysis-participant-link"
                              >
                                {p.personName}
                              </Link>
                            ) : (
                              p.name
                            )}
                            {onMeeting ? (
                              <span className="text-xs text-teal-600 dark:text-teal-400 mr-2">בפגישה</span>
                            ) : null}
                          </span>
                          <button
                            type="button"
                            className="btn btn-primary min-h-[44px]"
                            disabled={peopleBusy}
                            aria-expanded={linking}
                            onClick={() => {
                              setLinkIndex(linking ? null : i)
                              setLinkQuery('')
                              setConfirmRemoveIndex(null)
                            }}
                          >
                            קשר לאיש קשר קיים
                          </button>
                          {confirming ? (
                            <>
                              <p className="text-xs text-gray-600 dark:text-gray-400 w-full">
                                להסיר את {p.name} מהפגישה? איש הקשר יישאר באנשים.
                              </p>
                              <button
                                type="button"
                                className="btn btn-ghost min-h-[44px]"
                                disabled={peopleBusy}
                                onClick={() => setConfirmRemoveIndex(null)}
                              >
                                ביטול
                              </button>
                              <button
                                type="button"
                                className="btn min-h-[44px] bg-[#fb7185] text-[#0e1626]"
                                disabled={peopleBusy}
                                onClick={() =>
                                  removeParticipant.mutate({
                                    analysisId: analysis.id,
                                    participantIndex: i,
                                  })
                                }
                              >
                                הסר
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-ghost min-h-[44px]"
                              disabled={peopleBusy}
                              aria-label={
                                onMeeting
                                  ? `הסר את ${p.name} מהפגישה`
                                  : `הסר את ההצעה ${p.name}`
                              }
                              onClick={() => {
                                if (onMeeting) setConfirmRemoveIndex(i)
                                else {
                                  removeParticipant.mutate({
                                    analysisId: analysis.id,
                                    participantIndex: i,
                                  })
                                }
                              }}
                            >
                              הסר
                            </button>
                          )}
                        </div>
                        {linking && (
                          <div className="mt-2 space-y-1">
                            <input
                              className="input"
                              value={linkQuery}
                              onChange={(e) => setLinkQuery(e.target.value)}
                              placeholder="חפש איש קשר"
                              aria-label={`חיפוש איש קשר עבור ${p.name}`}
                            />
                            {linkChoices.slice(0, 8).map((person) => (
                              <button
                                key={person.id}
                                type="button"
                                className="btn btn-ghost min-h-[44px] w-full text-right"
                                disabled={peopleBusy}
                                onClick={() =>
                                  acceptParticipant.mutate({
                                    analysisId: analysis.id,
                                    participantIndex: i,
                                    personId: person.id,
                                  })
                                }
                              >
                                {person.name}
                                {person.company ? (
                                  <span className="text-[#7a89ab] mr-2">· {person.company}</span>
                                ) : null}
                              </button>
                            ))}
                            {linkQuery.trim().length >= 2 &&
                            !people.some(
                              (person) => person.name.trim().toLowerCase() === linkQuery.trim().toLowerCase(),
                            ) ? (
                              <button
                                type="button"
                                className="btn btn-ghost min-h-[44px] w-full text-right"
                                disabled={peopleBusy}
                                onClick={() =>
                                  acceptParticipant.mutate({
                                    analysisId: analysis.id,
                                    participantIndex: i,
                                    name: linkQuery.trim(),
                                  })
                                }
                              >
                                צור איש קשר «{linkQuery.trim()}» והוסף
                              </button>
                            ) : null}
                            {linkChoices.length === 0 && linkQuery.trim().length < 2 ? (
                              <p className="text-sm text-gray-500 dark:text-gray-400 px-1">הקלידו שם כדי לחפש באנשים</p>
                            ) : null}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              <AddPersonControl
                people={people}
                excludeIds={meetingPeopleIds}
                disabled={peopleBusy}
                onAttach={(input) => attachPerson.mutate({ meetingId, ...input })}
              />
              {peopleNotice ? <p className="mt-2 text-sm text-[#34d399]">{peopleNotice}</p> : null}
              {peopleError ? <p className="mt-2 text-sm text-[#fb7185]">{peopleError}</p> : null}
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
                  onClick={() => setBatchModalOpen(true)}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium transition-colors"
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
                    {item.personId && item.personName ? (
                      <div className="text-xs mt-1">
                        <Link
                          href={`/people?person=${item.personId}`}
                          className="text-teal-700 dark:text-teal-300 hover:underline"
                          data-testid="analysis-action-owner-link"
                        >
                          {item.personName}
                        </Link>
                      </div>
                    ) : (
                      item.owner && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {item.owner}
                        </div>
                      )
                    )}
                  </div>
                  {!item.taskId ? (
                    <button
                      onClick={() => openTaskModal(index)}
                      className="px-3 py-1 bg-teal-500 hover:bg-teal-600 text-white rounded text-xs font-medium transition-colors flex-shrink-0"
                    >
                      צור משימה
                    </button>
                  ) : (
                    <button
                      disabled
                      className="px-3 py-1 bg-teal-500/20 text-teal-600 dark:text-teal-400 rounded text-xs font-medium flex-shrink-0 cursor-not-allowed"
                    >
                      משימה נוצרה
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <MeetingTranscript meetingId={meetingId} />
      </div>

      {/* Task Creation Modals */}
      {selectedActionIndex !== null && analysis && (
        <TaskModal
          open={taskModalOpen}
          onClose={closeTaskModal}
          meetingId={meetingId}
          projectId={meeting?.projectId ?? null}
          workspaceId={null}
          initialValues={{
            title: analysis.actionItems[selectedActionIndex]?.content,
            priority: derivePriorityFromContext(analysis.actionItems[selectedActionIndex]?.content ?? ''),
            dueDate: meeting?.date,
            // A linked owner is already a People record; otherwise fall back to the name match.
            assigneeId:
              (analysis.actionItems[selectedActionIndex]?.personName && analysis.actionItems[selectedActionIndex]?.personId) ||
              matchPersonByName(analysis.actionItems[selectedActionIndex]?.owner),
          }}
          people={people}
          meetings={meetings}
          projects={projects}
          workspaces={workspaces}
          onCreated={handleTaskCreated}
        />
      )}

      {analysis && (
        <BatchTaskModal
          open={batchModalOpen}
          onClose={() => setBatchModalOpen(false)}
          analysisId={analysis.id}
          actionItems={analysis.actionItems}
          meetingId={meetingId}
          meetingDate={meeting?.date}
          projectId={meeting?.projectId ?? null}
          people={people}
          workspaces={workspaces}
          onSaved={handleBatchSaved}
        />
      )}
    </div>
  )
}
