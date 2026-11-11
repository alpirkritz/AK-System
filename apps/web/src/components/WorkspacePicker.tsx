'use client'

import { trpc } from '@/lib/trpc'

/** Grouped world select. The world itself is selectable; its workspaces sit under it. */
export function WorkspacePicker({
  id,
  value,
  onChange,
  disabled,
  className,
}: {
  id?: string
  value: string
  onChange: (id: string) => void
  disabled?: boolean
  className?: string
}) {
  const { data: tree = [] } = trpc.workspaces.tree.useQuery(undefined, { staleTime: 60_000 })
  return (
    <select
      id={id}
      className={className ?? 'select'}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">ללא עולם</option>
      {tree.map((world: { id: string; name: string; children: { id: string; name: string }[] }) => (
        <optgroup key={world.id} label={world.name}>
          <option value={world.id}>{world.name}</option>
          {world.children.map((child) => (
            <option key={child.id} value={child.id}>
              {child.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
