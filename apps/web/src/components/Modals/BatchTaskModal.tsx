'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc'
import { PRIORITY_LABELS, PRIORITY_COLORS } from '@ak-system/types'
import { PersonSelect, type PersonOption } from '@/components/ui/PersonSelect'
import { derivePriorityFromContext } from '@ak-system/api/src/services/meeting-analysis'
import type { Person } from '@ak-system/database'

type ActionItem = {
  content: string
  owner?: string
  taskId?: string
}

type WorkspaceOption = { id: string; name: string; hasNotionLink?: boolean }

interface BatchTaskItem {
  index: number
  title: string
  priority: 'high' | 'medium' | 'low'
  assigneeId: string
  dueDate: string
  workspaceId: string
  included: boolean
}

export function BatchTaskModal({
  open,
  onClose,
  analysisId,
  actionItems,
  meetingId,
  meetingDate,
  projectId,
  people,
  workspaces = [],
  onSaved,
}: {
  open: boolean
  onClose: () => void
  analysisId: string
  actionItems: ActionItem[]
  meetingId: string
  meetingDate?: string
  projectId?: string | null
  people: Person[]
  workspaces?: WorkspaceOption[]
  onSaved?: () => void
}) {
  const [items, setItems] = useState<BatchTaskItem[]>([])
  const utils = trpc.useUtils()
  const createTask = trpc.tasks.create.useMutation()
  const [saving, setSaving] = useState(false)

  // Initialize items from action items (only unassigned ones)
  useEffect(() => {
    if (!open) return
    const unassigned = actionItems
      .map((item, index) => ({ ...item, index }))
      .filter((item) => !item.taskId)

    setItems(
      unassigned.map((item) => ({
        index: item.index,
        title: item.content,
        priority: derivePriorityFromContext(item.content),
        assigneeId: matchPersonByName(item.owner, people),
        dueDate: meetingDate ?? '',
        workspaceId: '',
        included: true,
      }))
    )
  }, [open, actionItems, meetingDate, people])

  function matchPersonByName(ownerName: string | undefined, peopleList: Person[]): string {
    if (!ownerName) return ''
    const normalized = ownerName.trim().toLowerCase()
    const match = peopleList.find((p) => p.name.toLowerCase() === normalized)
    return match?.id ?? ''
  }

  const updateItem = (index: number, updates: Partial<BatchTaskItem>) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...updates } : item))
    )
  }

  const toggleIncluded = (index: number) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, included: !item.included } : item))
    )
  }

  const handleSave = async () => {
    const toCreate = items.filter((item) => item.included && item.title.trim())
    if (toCreate.length === 0) {
      onClose()
      return
    }

    setSaving(true)
    try {
      const createdTaskIds: Array<{ index: number; taskId: string }> = []

      for (const item of toCreate) {
        const result = await createTask.mutateAsync({
          title: item.title.trim(),
          meetingId: meetingId || null,
          projectId: projectId || null,
          workspaceId: item.workspaceId || null,
          assigneeId: item.assigneeId || null,
          dueDate: item.dueDate || null,
          priority: item.priority,
          status: 'not_started',
        })

        createdTaskIds.push({ index: item.index, taskId: result.id })
      }

      // Invalidate queries
      utils.tasks.list.invalidate()
      utils.tasks.listByMeeting.invalidate()
      utils.meetings.getAnalysis.invalidate()

      onSaved?.()
      onClose()
    } catch (error) {
      console.error('Batch create failed:', error)
    } finally {
      setSaving(false)
    }
  }

  const includedCount = items.filter((item) => item.included).length

  if (!open) return null

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={(e) => e.stopPropagation()}>
        <div className="font-bold text-lg mb-6 tracking-tight">
          צור משימות מאקשן אייטמס ({items.length} פריטים)
        </div>

        {items.length === 0 ? (
          <div className="text-[#7a89ab] py-6 text-center">
            כל האקשן אייטמס כבר הומרו למשימות
          </div>
        ) : (
          <>
            <div className="max-h-[60vh] overflow-y-auto space-y-4 mb-6">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-lg border transition-all"
                  style={{
                    borderColor: item.included ? '#2dd4bf55' : '#2f4368',
                    backgroundColor: item.included ? '#2dd4bf11' : 'transparent',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={item.included}
                      onChange={() => toggleIncluded(idx)}
                      className="mt-1 w-5 h-5 rounded border border-[#4d659c] bg-transparent accent-[#2dd4bf] cursor-pointer"
                    />
                    <div className="flex-1 space-y-3">
                      {/* Title */}
                      <input
                        className="input w-full"
                        value={item.title}
                        onChange={(e) => updateItem(idx, { title: e.target.value })}
                        placeholder="כותרת המשימה"
                        disabled={!item.included}
                      />

                      {/* Priority */}
                      <div>
                        <label className="label text-xs mb-1">עדיפות</label>
                        <div className="flex flex-wrap gap-2">
                          {(['high', 'medium', 'low'] as const).map((p) => (
                            <button
                              key={p}
                              type="button"
                              disabled={!item.included}
                              onClick={() => updateItem(idx, { priority: p })}
                              className="cursor-pointer inline-flex items-center min-h-[32px] py-1 px-3 rounded-[16px] border text-xs transition-all disabled:opacity-40"
                              style={{
                                borderColor: item.priority === p ? PRIORITY_COLORS[p] : '#2f4368',
                                background:
                                  item.priority === p ? PRIORITY_COLORS[p] + '22' : 'transparent',
                                color: item.priority === p ? PRIORITY_COLORS[p] : '#7a89ab',
                              }}
                            >
                              {PRIORITY_LABELS[p]}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Assignee */}
                      <div>
                        <label className="label text-xs mb-1" id={`batch-assignee-${idx}-label`}>
                          אחראי
                        </label>
                        <PersonSelect
                          id={`batch-assignee-${idx}`}
                          labelledBy={`batch-assignee-${idx}-label`}
                          value={item.assigneeId}
                          options={people}
                          selfId={null}
                          onChange={(personId) => updateItem(idx, { assigneeId: personId })}
                          disabled={!item.included}
                        />
                      </div>

                      {/* Due Date */}
                      <div>
                        <label className="label text-xs mb-1">תאריך יעד</label>
                        <input
                          className="input w-full"
                          type="date"
                          value={item.dueDate}
                          onChange={(e) => updateItem(idx, { dueDate: e.target.value })}
                          disabled={!item.included}
                        />
                      </div>

                      {/* Workspace */}
                      {workspaces.length > 0 && (
                        <div>
                          <label className="label text-xs mb-1">מקור</label>
                          <select
                            className="select w-full"
                            value={item.workspaceId}
                            onChange={(e) => updateItem(idx, { workspaceId: e.target.value })}
                            disabled={!item.included}
                          >
                            <option value="">ללא מקור</option>
                            {workspaces.map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2.5 justify-end">
              <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
                ביטול
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving || includedCount === 0}
              >
                {saving ? 'שומר...' : `צור ${includedCount} משימות`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
