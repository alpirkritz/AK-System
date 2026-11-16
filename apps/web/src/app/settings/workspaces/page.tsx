'use client'

import { WorldScopePanel } from '@/components/WorldScopePanel'
import { useState } from 'react'
import Link from 'next/link'
import { Pencil, Trash2 } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { workspaceKindLabel } from '@/components/people/affiliations'
import dynamic from 'next/dynamic'
const WorkspaceModal = dynamic(
  () => import('@/components/Modals/WorkspaceModal').then((m) => m.WorkspaceModal),
  { ssr: false },
)
const AddPeopleSourceModal = dynamic(
  () => import('@/components/Modals/AddPeopleSourceModal').then((m) => m.AddPeopleSourceModal),
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
    if (!window.confirm(`למחוק את העולם "${name}"? המשימות יישארו אך יאבדו את השיוך.`)) return
    remove.mutate({ id })
  }

  return (
    <div className="max-w-3xl mx-auto pb-16" data-testid="workspaces-settings">
      <div className="mb-6">
        <Link href="/settings" className="text-xs text-[#5a688c] hover:text-[#7a89ab]">
          ← חזרה להגדרות
        </Link>
        <div className="flex justify-between items-center mt-2">
          <h1 className="text-xl font-bold">עולמות</h1>
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingId(null)
              setModalOpen(true)
            }}
          >
            + עולם חדש
          </button>
        </div>
        <p className="text-xs text-[#5a688c] mt-1">
          כל עולם הוא חלק מהחיים — DAZ, Dragontail, Alpir Consulting או פרטי. סביבת עבודה יושבת בתוך עולם. בסיס נתונים ב-Notion עדיין קובע מאיפה משימה הגיעה.
        </p>
      </div>

      {isLoading ? (
        <div className="card">
          <div className="skeleton h-5 w-1/3 mb-3" />
          <div className="skeleton h-5 w-1/2" />
        </div>
      ) : workspaces.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-[#eef3fb] font-medium mb-1">אין עולמות</div>
          <div className="text-sm text-[#647399] mb-4">הוסף עולם ראשון כדי לשייך אליו משימות, פגישות ואנשים.</div>
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingId(null)
              setModalOpen(true)
            }}
          >
            + עולם חדש
          </button>
        </div>
      ) : (
        <div className="card py-1 px-4">
          {workspaces.filter((w) => !w.parentId).map((w) => (
            <div key={w.id}>
            <div className="task-row">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: w.color ?? '#2dd4bf' }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[#eef3fb]">
                  {w.name}
                  {w.kind && <span className="text-[#7a89ab]"> · {workspaceKindLabel(w.kind)}</span>}
                </div>
                <div className="text-[11px] text-[#647399] truncate">
                  {(w as { notionDatabases?: unknown[] }).notionDatabases?.length
                    ? `🔗 ${(w as { notionDatabases: unknown[] }).notionDatabases.length} מקושרים`
                    : w.notionAccountLabel
                      ? `Notion: ${w.notionAccountLabel}`
                      : 'אין קישור Notion'}
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
            {workspaces.filter((child) => child.parentId === w.id).map((child) => (
              <div key={child.id} className="task-row ps-6">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: child.color ?? w.color ?? '#2dd4bf' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[#eef3fb]">{child.name}</div>
                  <div className="text-[11px] text-[#647399]">סביבת עבודה בתוך {w.name}</div>
                </div>
                <button type="button" className="icon-btn" aria-label={`ערוך את ${child.name}`} onClick={() => { setEditingId(child.id); setModalOpen(true) }}>
                  <Pencil size={16} />
                </button>
                <button type="button" className="icon-btn danger" aria-label={`מחק את ${child.name}`} disabled={remove.isPending} onClick={() => handleDelete(child.id, child.name)}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
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

      <WorldScopePanel />
      <PeopleNotionSources />
    </div>
  )
}

/** Self-service registration of additional Notion "people" databases — see docs/specs/notion-people-source-manager.md */
function PeopleNotionSources() {
  const utils = trpc.useUtils()
  const { data: accounts = [] } = trpc.people.notionAccounts.useQuery()
  const { data: sources = [], isLoading } = trpc.people.notionSources.useQuery()
  const [addOpen, setAddOpen] = useState(false)
  const remove = trpc.people.removeNotionSource.useMutation({
    onSuccess: () => utils.people.notionSources.invalidate(),
  })

  return (
    <div className="mt-8">
      <div className="mb-2">
        <h2 className="text-sm font-bold text-[#b8c4dc]">בסיסי נתונים של אנשים ב-Notion</h2>
        <p className="text-xs text-[#5a688c] mt-1">
          כל בסיס נתונים כאן נסרק כשמסנכרנים אנשים מ-Notion (בעמוד אנשים ובקרון האוטומטי כל 30 דקות).
        </p>
      </div>

      {accounts.length === 0 ? (
        <div className="card text-center py-8">
          <div className="text-sm text-[#647399]">Notion לא מוגדר</div>
        </div>
      ) : isLoading ? (
        <div className="card">
          <div className="skeleton h-5 w-1/2" />
        </div>
      ) : (
        <>
          <div className="flex justify-end mb-2">
            <button type="button" className="btn btn-secondary text-xs py-1 px-3" onClick={() => setAddOpen(true)}>
              + הוסף בסיס נתונים
            </button>
          </div>
          {sources.length === 0 ? (
            <div className="card text-center py-8">
              <div className="text-sm text-[#647399]">לא נמצא אף בסיס נתונים של אנשים.</div>
            </div>
          ) : (
            <div className="card py-1 px-4">
              {sources.map((s) => (
                <div key={s.notionDatabaseId} className="task-row">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[#eef3fb]">{s.name}</div>
                    <div className="text-[11px] text-[#647399] truncate">{s.accountLabel}</div>
                  </div>
                  {s.source === 'env' ? (
                    <span className="pill text-[11px]">מוגדר בקוד</span>
                  ) : (
                    <button
                      type="button"
                      className="icon-btn danger"
                      aria-label={`הסר את ${s.name}`}
                      disabled={remove.isPending}
                      onClick={() => {
                        if (!window.confirm(`להסיר את "${s.name}" ממקורות האנשים?`)) return
                        remove.mutate({ id: s.id! })
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <AddPeopleSourceModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}
