'use client'

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { SearchableAddSelect } from '@/components/ui/SearchableAddSelect'

export type MemoryLinkKind = 'person' | 'project' | 'workspace' | 'topic' | 'agent'

export interface MemoryLinkChip {
  kind: MemoryLinkKind
  entityId: string
  label: string
}

const KIND_PREFIX: Record<MemoryLinkKind, string> = {
  person: '👤',
  project: '📁',
  workspace: '🌐',
  topic: '#',
  agent: '🤖',
}

const KIND_NAME: Record<MemoryLinkKind, string> = {
  person: 'אדם',
  project: 'פרויקט',
  workspace: 'סביבת עבודה',
  topic: 'נושא',
  agent: 'סוכן',
}

export function linkKey(l: { kind: string; entityId: string }): string {
  return `${l.kind}:${l.entityId}`
}

/** One link chip. `onRemove` adds a remove button; `onClick` makes the label a filter. */
export function MemoryLinkChipView({
  link,
  onRemove,
  onClick,
  muted,
}: {
  link: MemoryLinkChip
  onRemove?: () => void
  onClick?: () => void
  muted?: boolean
}) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border"
      style={{
        background: muted ? 'transparent' : '#2dd4bf14',
        borderColor: muted ? '#29395d' : '#2dd4bf44',
        color: muted ? '#5a688c' : '#97e6da',
        textDecoration: muted ? 'line-through' : undefined,
      }}
      data-testid="memory-link-chip"
    >
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="inline-flex items-center gap-1 disabled:cursor-default"
        title={KIND_NAME[link.kind]}
      >
        <span aria-hidden>{KIND_PREFIX[link.kind]}</span>
        <span>{link.label}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`הסר קישור ל${link.label}`}
          className="text-[#5a688c] hover:text-[#cdd7ea]"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  )
}

/** Picker that adds one link of any kind. */
export function MemoryLinkAdder({ onAdd }: { onAdd: (link: MemoryLinkChip) => void }) {
  const [kind, setKind] = useState<MemoryLinkKind>('person')
  const [topic, setTopic] = useState('')
  const { data: people = [] } = trpc.people.list.useQuery(undefined, { enabled: kind === 'person' })
  const { data: projects = [] } = trpc.projects.list.useQuery(undefined, { enabled: kind === 'project' })
  const { data: workspaces = [] } = trpc.workspaces.list.useQuery(undefined, { enabled: kind === 'workspace' })
  const { data: agentsData } = trpc.agents.list.useQuery(undefined, { enabled: kind === 'agent' })

  const options = useMemo(() => {
    if (kind === 'agent') {
      const agents = ((agentsData as { agents?: Array<{ agentId: string; name: string }> } | undefined)?.agents ?? [])
      return agents.map((a) => ({ id: a.agentId, name: a.name }))
    }
    const rows: Array<{ id: string; name: string }> =
      kind === 'person' ? people : kind === 'project' ? projects : kind === 'workspace' ? workspaces : []
    return rows.map((r) => ({ id: r.id, name: r.name }))
  }, [kind, people, projects, workspaces, agentsData])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as MemoryLinkKind)}
        className="input text-[12px] py-1 w-auto"
        aria-label="סוג קישור"
      >
        {(Object.keys(KIND_NAME) as MemoryLinkKind[]).map((k) => (
          <option key={k} value={k}>
            {KIND_NAME[k]}
          </option>
        ))}
      </select>
      {kind === 'topic' ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const t = topic.trim()
            if (!t) return
            onAdd({ kind: 'topic', entityId: t, label: t })
            setTopic('')
          }}
        >
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="לדוגמה: DD, Algo 4"
            className="input text-[12px] py-1 w-40"
            dir="auto"
          />
          <button type="submit" className="btn btn-ghost text-[11px] py-1 px-2" disabled={!topic.trim()}>
            הוסף נושא
          </button>
        </form>
      ) : (
        <div className="min-w-[180px]">
          <SearchableAddSelect
            id={`memory-link-${kind}`}
            options={options}
            triggerLabel={`קשר ל${KIND_NAME[kind]}…`}
            onAdd={(id) => {
              const hit = options.find((o) => o.id === id)
              if (hit) onAdd({ kind, entityId: hit.id, label: hit.name })
            }}
          />
        </div>
      )}
    </div>
  )
}

/** Editable chip row for an existing memory. Saves through `memory.memories.setLinks`. */
export function MemoryLinkEditor({
  memoryId,
  links,
  onFilter,
}: {
  memoryId: string
  links: MemoryLinkChip[]
  onFilter?: (link: MemoryLinkChip) => void
}) {
  const utils = trpc.useUtils()
  const [adding, setAdding] = useState(false)
  const setLinks = trpc.memory.memories.setLinks.useMutation({
    onSuccess: () => void utils.memory.memories.list.invalidate(),
  })
  const save = (next: MemoryLinkChip[]) =>
    setLinks.mutate({ id: memoryId, links: next.map((l) => ({ kind: l.kind, entityId: l.entityId })) })

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {links.length === 0 && <span className="text-[10px] text-[#5a688c]">כללי — נכנס לכל שיחה</span>}
      {links.map((l) => (
        <MemoryLinkChipView
          key={linkKey(l)}
          link={l}
          onClick={onFilter ? () => onFilter(l) : undefined}
          onRemove={() => save(links.filter((x) => linkKey(x) !== linkKey(l)))}
        />
      ))}
      {adding ? (
        <MemoryLinkAdder
          onAdd={(l) => {
            if (!links.some((x) => linkKey(x) === linkKey(l))) save([...links, l])
            setAdding(false)
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-[11px] text-[#5a688c] hover:text-[#2dd4bf]"
        >
          + קישור
        </button>
      )}
    </div>
  )
}
