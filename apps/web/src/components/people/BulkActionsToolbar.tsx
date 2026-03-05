'use client'

import { useState } from 'react'
import { Tag, Target, Download, Trash2, XCircle } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { CreatableSelect } from '@/components/ui/CreatableSelect'

const GOAL_OPTIONS = ['', 'Bi-Weekly', 'Monthly', 'Bi-Monthly', 'Quarterly'] as const

interface Props {
  selectedIds: Set<string>
  onDeselectAll: () => void
  allTags: string[]
  onSuccess: () => void
  allPeople: Array<{ id: string; name: string; email?: string | null; phone?: string | null; company?: string | null; tags?: string | null }>
}

export function BulkActionsToolbar({ selectedIds, onDeselectAll, allTags, onSuccess, allPeople }: Props) {
  const [showTagInput, setShowTagInput] = useState(false)
  const [showGoalSelect, setShowGoalSelect] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const utils = trpc.useUtils()
  const ids = Array.from(selectedIds)

  const bulkDelete = trpc.people.bulkDelete.useMutation({
    onSuccess: () => {
      utils.people.listPaginated.invalidate()
      utils.people.filterOptions.invalidate()
      onDeselectAll()
      setConfirmDelete(false)
      onSuccess()
    },
  })

  const bulkAddTag = trpc.people.bulkAddTag.useMutation({
    onSuccess: () => {
      utils.people.listPaginated.invalidate()
      utils.people.filterOptions.invalidate()
      setShowTagInput(false)
      onSuccess()
    },
  })

  const bulkUpdateGoal = trpc.people.bulkUpdateGoal.useMutation({
    onSuccess: () => {
      utils.people.listPaginated.invalidate()
      setShowGoalSelect(false)
      onSuccess()
    },
  })

  const handleExportCsv = () => {
    const selectedPeople = allPeople.filter(p => selectedIds.has(p.id))
    const header = 'Name,Email,Phone,Company,Tags'
    const rows = selectedPeople.map(p =>
      [p.name, p.email ?? '', p.phone ?? '', p.company ?? '', p.tags ?? '']
        .map(v => `"${v.replace(/"/g, '""')}"`)
        .join(',')
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `people-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (selectedIds.size === 0) return null

  return (
    <div className="bulk-toolbar mb-4">
      <span className="text-sm font-medium text-[#f0ede6] shrink-0 tabular-nums">
        {selectedIds.size} נבחרו
      </span>

      <div className="w-px h-5 bg-[#333]" />

      {/* Add tag */}
      <div className="relative">
        <button
          className="btn btn-ghost flex items-center gap-1.5 text-xs"
          onClick={() => { setShowTagInput(!showTagInput); setShowGoalSelect(false) }}
        >
          <Tag className="w-3.5 h-3.5" />
          הוסף תגית
        </button>
        {showTagInput && (
          <div className="absolute top-full mt-1 right-0 z-20 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-2 min-w-[220px]">
            <div className="mb-2">
              <CreatableSelect
                value=""
                options={allTags}
                onChange={v => {
                  if (v) {
                    bulkAddTag.mutate({ ids, tag: v })
                    setShowTagInput(false)
                  }
                }}
                placeholder="בחר או הקלד תגית..."
              />
            </div>
            {allTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {allTags.slice(0, 10).map(tag => (
                  <button
                    key={tag}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-[#222] text-[#aaa] hover:text-[#f0ede6] transition-colors border border-[#333]"
                    onClick={() => { bulkAddTag.mutate({ ids, tag }); setShowTagInput(false) }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Change goal */}
      <div className="relative">
        <button
          className="btn btn-ghost flex items-center gap-1.5 text-xs"
          onClick={() => { setShowGoalSelect(!showGoalSelect); setShowTagInput(false) }}
        >
          <Target className="w-3.5 h-3.5" />
          שנה יעד
        </button>
        {showGoalSelect && (
          <div className="absolute top-full mt-1 right-0 z-20 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg py-1 min-w-[140px]">
            {GOAL_OPTIONS.map(goal => (
              <button
                key={goal || 'none'}
                className="w-full text-right px-3 py-1.5 text-xs text-[#aaa] hover:bg-[#222] transition-colors"
                onClick={() => bulkUpdateGoal.mutate({ ids, goal })}
              >
                {goal || 'ללא יעד'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Export */}
      <button
        className="btn btn-ghost flex items-center gap-1.5 text-xs"
        onClick={handleExportCsv}
      >
        <Download className="w-3.5 h-3.5" />
        ייצוא CSV
      </button>

      <div className="flex-1" />

      {/* Delete */}
      {!confirmDelete ? (
        <button
          className="btn btn-ghost flex items-center gap-1.5 text-xs text-error border-error/20 hover:bg-error/10 hover:border-error/40"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="w-3.5 h-3.5" />
          מחק
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs text-error">למחוק {selectedIds.size} אנשים?</span>
          <button
            className="btn text-xs px-3 py-1 bg-error text-white hover:bg-[#d03060]"
            onClick={() => bulkDelete.mutate({ ids })}
            disabled={bulkDelete.isPending}
          >
            אישור
          </button>
          <button
            className="btn btn-ghost text-xs py-1"
            onClick={() => setConfirmDelete(false)}
          >
            ביטול
          </button>
        </div>
      )}

      <div className="w-px h-5 bg-[#333]" />

      {/* Deselect */}
      <button
        className="icon-btn"
        onClick={onDeselectAll}
        title="בטל בחירה"
      >
        <XCircle className="w-4 h-4" />
      </button>
    </div>
  )
}
