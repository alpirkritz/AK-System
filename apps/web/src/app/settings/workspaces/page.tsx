'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Pencil, Trash2 } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import dynamic from 'next/dynamic'
const WorkspaceModal = dynamic(
  () => import('@/components/Modals/WorkspaceModal').then((m) => m.WorkspaceModal),
  { ssr: false },
)

export default function WorkspacesSettingsPage() {
  const { data: workspaces = [], isLoading } = trpc.workspaces.list.useQuery()
  const { data: tasksList = [] } = trpc.tasks.list.useQuery()
  const utils = trpc.useUtils()
  const remove = trpc.workspaces.delete.useMutation({
    onSuccess: () => {
      utils.workspaces.list.invalidate()
      utils.tasks.list.invalidate()
    },
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const taskCount = (workspaceId: string) =>
    (tasksList as Array<{ workspaceId?: string | null }>).filter((t) => t.workspaceId === workspaceId).length

  const handleDelete = (id: string, name: string) => {
    if (!window.confirm(`למחוק את המקור "${name}"? המשימות יישארו אך יאבדו את השיוך.`)) return
    remove.mutate({ id })
  }

  return (
    <div className="max-w-3xl mx-auto pb-16" data-testid="workspaces-settings">
      <div className="mb-6">
        <Link href="/settings" className="text-xs text-[#5a688c] hover:text-[#7a89ab]">
          ← חזרה להגדרות
        </Link>
        <div className="flex justify-between items-center mt-2">
          <h1 className="text-xl font-bold">מקורות</h1>
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingId(null)
              setModalOpen(true)
            }}
          >
            + מקור חדש
          </button>
        </div>
        <p className="text-xs text-[#5a688c] mt-1">
          כל משימה משויכת למקור — Alpir Consulting, Dragontail, DAZ או פרטי. תווית Notion ממפה משימות מסונכרנות אוטומטית.
        </p>
      </div>

      {isLoading ? (
        <div className="card">
          <div className="skeleton h-5 w-1/3 mb-3" />
          <div className="skeleton h-5 w-1/2" />
        </div>
      ) : workspaces.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-[#eef3fb] font-medium mb-1">אין מקורות</div>
          <div className="text-sm text-[#647399] mb-4">הוסף מקור ראשון כדי לשייך אליו משימות.</div>
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingId(null)
              setModalOpen(true)
            }}
          >
            + מקור חדש
          </button>
        </div>
      ) : (
        <div className="card py-1 px-4">
          {workspaces.map((w) => (
            <div key={w.id} className="task-row">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: w.color ?? '#2dd4bf' }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[#eef3fb]">{w.name}</div>
                <div className="text-[11px] text-[#647399] truncate">
                  {w.notionAccountLabel ? `Notion: ${w.notionAccountLabel}` : 'ללא תווית Notion'}
                  {' · '}
                  {taskCount(w.id)} משימות
                </div>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label={`ערוך את ${w.name}`}
                onClick={() => {
                  setEditingId(w.id)
                  setModalOpen(true)
                }}
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                className="icon-btn danger"
                aria-label={`מחק את ${w.name}`}
                disabled={remove.isPending}
                onClick={() => handleDelete(w.id, w.name)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <WorkspaceModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setEditingId(null)
        }}
        editingId={editingId}
      />
    </div>
  )
}
