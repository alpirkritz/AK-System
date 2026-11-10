'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import { CommitmentTaskModal } from '@/components/commitments/CommitmentTaskModal'

/**
 * Opens an accepted commitment from "חייבים לי" in TaskModal; saving creates the task and links it
 * (`commitments.linkTask`), so the row turns into a normal, editable task. Mount `modal` once per surface.
 * TaskModal closes as soon as the task is created, so a link failure is shown by `modal`, next to the list.
 */
export function useCommitmentEditor() {
  const utils = trpc.useUtils()
  const [commitmentId, setCommitmentId] = useState<string | null>(null)
  const linkTask = trpc.commitments.linkTask.useMutation({
    onSettled: () => {
      void utils.waiting.list.invalidate()
      void utils.tasks.list.invalidate()
      void utils.commitments.invalidate()
    },
  })

  const modal = (
    <>
      {linkTask.error && (
        <p className="text-xs text-[#e57373] mb-2" role="alert" data-testid="waiting-link-error">
          המשימה נוצרה אבל לא קושרה להתחייבות: {linkTask.error.message}
        </p>
      )}
      <CommitmentTaskModal
        commitmentId={commitmentId}
        onClose={() => setCommitmentId(null)}
        onCreated={(id, taskId) => linkTask.mutate({ commitmentId: id, taskId })}
      />
    </>
  )

  const open = (id: string) => {
    linkTask.reset()
    setCommitmentId(id)
  }

  return { open, modal }
}
