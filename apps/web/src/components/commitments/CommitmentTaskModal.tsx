'use client'

import { useMemo } from 'react'
import { trpc } from '@/lib/trpc'
import { TaskModal } from '@/components/Modals/TaskModal'

/**
 * TaskModal prefilled from one commitment (`commitments.taskPrefill`). Opens only once the prefill
 * has loaded, so the form never starts with an empty title. The caller decides what linking the
 * created task means (`accept` for proposed commitments, `linkTask` for accepted ones).
 */
export function CommitmentTaskModal({
  commitmentId,
  onClose,
  onCreated,
}: {
  commitmentId: string | null
  onClose: () => void
  onCreated: (commitmentId: string, taskId: string) => void
}) {
  const enabled = commitmentId != null
  const { data: prefill } = trpc.commitments.taskPrefill.useQuery(
    { commitmentId: commitmentId! },
    { enabled },
  )
  const { data: people = [] } = trpc.people.list.useQuery(undefined, { enabled })
  const { data: meetings = [] } = trpc.meetings.list.useQuery(undefined, { enabled })
  const { data: projects = [] } = trpc.projects.list.useQuery(undefined, { enabled })
  const { data: workspaces = [] } = trpc.workspaces.list.useQuery(undefined, { enabled })

  // A stable object: TaskModal resets the form whenever `initialValues` changes identity.
  const initialValues = useMemo(
    () => ({
      title: prefill?.title ?? '',
      dueDate: prefill?.dueDate ?? undefined,
      assigneeId: prefill?.assigneeId ?? undefined,
    }),
    [prefill],
  )

  return (
    <TaskModal
      open={enabled && prefill != null}
      onClose={onClose}
      meetingId={prefill?.meetingId ?? null}
      projectId={prefill?.projectId ?? null}
      people={people}
      meetings={meetings.map((m) => ({ id: m.id, title: m.title }))}
      projects={projects.map((p) => ({ id: p.id, name: p.name, workspaceId: (p as { workspaceId?: string | null }).workspaceId ?? null }))}
      workspaces={workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        hasNotionLink: ((w as { notionDatabases?: unknown[] }).notionDatabases?.length ?? 0) > 0,
      }))}
      initialValues={initialValues}
      explanations={prefill?.explanations}
      onCreated={(_notionSync, task) => {
        if (commitmentId && task?.id) onCreated(commitmentId, task.id)
      }}
    />
  )
}
