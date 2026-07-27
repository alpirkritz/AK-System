'use client'

export type WorkspaceOption = { id: string; name: string; color?: string | null }

const DEFAULT_COLOR = '#2dd4bf'

/** Color-coded origin tag for a task. Falls back to a muted "unassigned" pill. */
export function WorkspacePill({ workspace }: { workspace?: WorkspaceOption | null }) {
  if (!workspace) {
    return <span className="pill text-[11px]">לא משויך</span>
  }
  const color = workspace.color ?? DEFAULT_COLOR
  return (
    <span
      className="pill text-[11px] whitespace-nowrap"
      style={{ background: color + '22', borderColor: color + '55', color }}
    >
      {workspace.name}
    </span>
  )
}
