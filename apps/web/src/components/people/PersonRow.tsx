'use client'

import { memo } from 'react'
import { Mail, Phone, StickyNote } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { he } from 'date-fns/locale'
import { cn } from '@/lib/cn'
import type { Person } from '@ak-system/database'

const TAG_COLORS: Record<string, string> = {
  business: '#47b8e8',
  friend: '#47e8a8',
  mentor: '#b847e8',
}

const GOAL_COLORS: Record<string, string> = {
  'Bi-Weekly': '#47b8e8',
  Monthly: '#47e8a8',
  'Bi-Monthly': '#e8c547',
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
  selected: boolean
  onToggleSelect: () => void
  onOpenDrawer: () => void
}

export const PersonRow = memo(function PersonRow({ person, selected, onToggleSelect, onOpenDrawer }: Props) {
  const tags = person.tags ? person.tags.split(',').map(t => t.trim()).filter(Boolean) : []
  const health = getContactHealth(person.lastContact, person.contactFrequencyDays)

  const handleRowClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-action]') || target.closest('[data-checkbox]')) return
    onOpenDrawer()
  }

  return (
    <tr
      className={cn('table-row group', selected && 'selected')}
      onClick={handleRowClick}
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onOpenDrawer() }}
    >
      {/* Checkbox */}
      <td className="table-cell w-[40px]" data-checkbox>
        <button
          className="checkbox-btn"
          aria-checked={selected}
          onClick={e => { e.stopPropagation(); onToggleSelect() }}
          aria-label={`בחר ${person.name}`}
        >
          {selected && <span className="text-[10px]">✓</span>}
        </button>
      </td>

      {/* Name + avatar */}
      <td className="table-cell">
        <div className="flex items-center gap-2.5">
          <div
            className="avatar w-8 h-8 text-xs border"
            style={{
              background: (person.color ?? '#e8c547') + '18',
              color: person.color ?? '#e8c547',
              borderColor: (person.color ?? '#e8c547') + '30',
            }}
          >
            {person.name[0]}
          </div>
          <span className="font-medium text-[#f0ede6] text-sm truncate max-w-[200px]">
            {person.name}
          </span>
        </div>
      </td>

      {/* Company */}
      <td className="table-cell text-[#aaa] truncate max-w-[160px]" title={person.company ?? undefined}>
        {person.company || '—'}
      </td>

      {/* Role */}
      <td className="table-cell text-[#888] truncate max-w-[140px]" title={person.jobTitle ?? person.role ?? undefined}>
        {person.jobTitle || person.role || '—'}
      </td>

      {/* Goal */}
      <td className="table-cell">
        {person.goal ? (
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: (GOAL_COLORS[person.goal] ?? '#888') + '18',
              color: GOAL_COLORS[person.goal] ?? '#888',
            }}
          >
            {person.goal}
          </span>
        ) : (
          <span className="text-[#444]">—</span>
        )}
      </td>

      {/* Tags */}
      <td className="table-cell">
        <div className="flex items-center gap-1">
          {tags.slice(0, 2).map(tag => (
            <span
              key={tag}
              className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{
                background: (TAG_COLORS[tag.toLowerCase()] ?? '#e8c547') + '18',
                color: TAG_COLORS[tag.toLowerCase()] ?? '#e8c547',
              }}
            >
              {tag}
            </span>
          ))}
          {tags.length > 2 && (
            <span className="text-[10px] text-[#555]" title={tags.slice(2).join(', ')}>
              +{tags.length - 2}
            </span>
          )}
        </div>
      </td>

      {/* Last contact */}
      <td className="table-cell">
        {person.lastContact ? (
          <div className="contact-health">
            {health && <span className={cn('contact-health-dot', health)} />}
            <span className="text-[#aaa] text-xs">
              {formatDistanceToNow(new Date(person.lastContact), { addSuffix: true, locale: he })}
            </span>
          </div>
        ) : (
          <span className="text-[#444] text-xs">—</span>
        )}
      </td>

      {/* Quick actions */}
      <td className="table-cell" data-action>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {person.email && (
            <a
              href={`mailto:${person.email}`}
              className="icon-btn"
              title={`שלח מייל ל${person.name}`}
              onClick={e => e.stopPropagation()}
            >
              <Mail className="w-3.5 h-3.5" />
            </a>
          )}
          {person.phone && (
            <a
              href={`tel:${person.phone}`}
              className="icon-btn"
              title={`התקשר ל${person.name}`}
              onClick={e => e.stopPropagation()}
            >
              <Phone className="w-3.5 h-3.5" />
            </a>
          )}
          <button
            className="icon-btn"
            title="הוסף הערה"
            onClick={e => { e.stopPropagation(); onOpenDrawer() }}
          >
            <StickyNote className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  )
})
