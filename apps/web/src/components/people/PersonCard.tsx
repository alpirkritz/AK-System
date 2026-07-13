'use client'

import { memo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { he } from 'date-fns/locale'
import { cn } from '@/lib/cn'
import type { Person } from '@ak-system/database'

const TAG_COLORS: Record<string, string> = {
  business: '#38bdf8',
  friend: '#47e8a8',
  mentor: '#b847e8',
}

const GOAL_COLORS: Record<string, string> = {
  'Bi-Weekly': '#38bdf8',
  Monthly: '#47e8a8',
  'Bi-Monthly': '#2dd4bf',
  Quarterly: '#b847e8',
}

function getContactHealth(lastContact: string | null, frequencyDays: number | null): 'green' | 'yellow' | 'red' | null {
  if (!lastContact || !frequencyDays) return null
  const last = new Date(lastContact)
  const daysSince = Math.floor((Date.now() - last.getTime()) / (1000 * 60 * 60 * 24))
  if (daysSince <= frequencyDays * 0.7) return 'green'
  if (daysSince <= frequencyDays) return 'yellow'
  return 'red'
}

interface Props {
  person: Person
  onOpenDrawer: () => void
}

export const PersonCard = memo(function PersonCard({ person, onOpenDrawer }: Props) {
  const tags = person.tags ? person.tags.split(',').map(t => t.trim()).filter(Boolean) : []
  const color = person.color ?? '#2dd4bf'
  const health = getContactHealth(person.lastContact, person.contactFrequencyDays)

  return (
    <div
      className="card-interactive"
      onClick={onOpenDrawer}
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onOpenDrawer() }}
      role="button"
      aria-label={`פתח פרטי ${person.name}`}
    >
      <div className="flex gap-3 items-center mb-3">
        <div
          className="avatar w-10 h-10 text-sm border-2 shrink-0"
          style={{
            background: color + '18',
            color,
            borderColor: color + '30',
          }}
        >
          {person.name[0]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm text-[#eef3fb] truncate">{person.name}</div>
          {(person.jobTitle || person.role) && (
            <div className="text-xs text-[#647399] truncate">{person.jobTitle || person.role}</div>
          )}
        </div>
        {person.goal && (
          <span
            className="text-[9px] font-semibold px-2 py-0.5 rounded-full shrink-0"
            style={{
              background: (GOAL_COLORS[person.goal] ?? '#7a89ab') + '18',
              color: GOAL_COLORS[person.goal] ?? '#7a89ab',
            }}
          >
            {person.goal}
          </span>
        )}
      </div>

      {person.company && (
        <div className="text-xs text-[#7a89ab] mb-2 truncate">{person.company}</div>
      )}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2.5">
          {tags.slice(0, 2).map(tag => (
            <span
              key={tag}
              className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{
                background: (TAG_COLORS[tag.toLowerCase()] ?? '#2dd4bf') + '18',
                color: TAG_COLORS[tag.toLowerCase()] ?? '#2dd4bf',
              }}
            >
              {tag}
            </span>
          ))}
          {tags.length > 2 && (
            <span className="text-[10px] text-[#5a688c]">+{tags.length - 2}</span>
          )}
        </div>
      )}

      <div className="border-t border-[#223052] pt-2.5 flex items-center gap-3 text-xs text-[#647399]">
        {person.lastContact ? (
          <span className="contact-health">
            {health && <span className={cn('contact-health-dot', health)} />}
            {formatDistanceToNow(new Date(person.lastContact), { addSuffix: true, locale: he })}
          </span>
        ) : (
          <span>אין היסטוריית קשר</span>
        )}
        {person.email && <span className="truncate mr-auto text-[#5a688c]">{person.email}</span>}
      </div>
    </div>
  )
})
