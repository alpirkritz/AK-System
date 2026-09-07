'use client'

import Link from 'next/link'
import { DAYS_HE } from '@ak-system/types'
import { formatMeetingTitle } from '../lib/format-title'

const SOURCE_LABEL: Record<string, string> = { google: 'Google', apple: 'Apple' }
const SOURCE_COLOR: Record<string, string> = { google: '#4285f4', apple: '#7a89ab' }

const MEETING_SOURCE_ICONS: Record<string, string> = {
  calendar: '🗓️',
  notion_note: '📝',
  manual: '✏️',
}

const MEETING_SOURCE_LABELS: Record<string, string> = {
  calendar: 'Calendar',
  notion_note: 'Notion',
  manual: 'Manual',
}

export interface MeetingCardData {
  id: string
  title: string
  date: string
  time: string
  recurring: string | null
  recurrenceDay: string | null
  projectId?: string | null
  typeId?: string | null
  seriesId?: string | null
  calendarEventId?: string | null
  calendarSource?: string | null
  source?: string | null
  peopleIds?: string[]
  taskIds?: string[]
}

interface Project {
  id: string
  name: string
}

interface MeetingType {
  id: string
  name: string
  color?: string | null
}

interface Person {
  id: string
  name: string
  color?: string | null
}

interface MeetingCardProps {
  meeting: MeetingCardData
  importance?: 'urgent' | 'normal' | 'compact'
  past?: boolean
  projects?: Project[]
  meetingTypes?: Map<string, MeetingType>
  getPerson?: (id: string) => Person | undefined
  onEdit?: () => void
  onDelete?: () => void
}

export function MeetingCard({
  meeting,
  importance = 'normal',
  past = false,
  projects = [],
  meetingTypes = new Map(),
  getPerson = () => undefined,
  onEdit,
  onDelete,
}: MeetingCardProps) {
  const m = meeting
  const proj = m.projectId ? projects.find((p) => p.id === m.projectId) : null
  const mtype = m.typeId ? meetingTypes.get(m.typeId) : null

  const cardClass = `meeting-card py-4 px-5 ${
    importance === 'urgent' ? 'meeting-card-today' : ''
  } ${importance === 'compact' ? 'meeting-card-compact' : ''}`

  return (
    <div key={m.id} className={`group relative ${past ? 'opacity-50' : ''}`}>
      <Link href={`/meetings/${m.id}`} className="block">
        <div className={cardClass}>
          <div className="flex justify-between items-center">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span
                  className={`font-semibold ${importance === 'compact' ? 'text-[13px]' : 'text-[15px]'} ${
                    past ? 'text-[#6f7ea0]' : ''
                  }`}
                >
                  {formatMeetingTitle(m.title)}
                </span>
                {past && (
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0"
                    style={{ background: '#ffffff08', color: '#5a688c', border: '1px solid #2f4368' }}
                  >
                    עבר
                  </span>
                )}
                {importance !== 'compact' && proj && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                    style={{ background: '#2dd4bf22', color: '#2dd4bf', border: '1px solid #2dd4bf33' }}
                  >
                    📁 {proj.name}
                  </span>
                )}
                {importance !== 'compact' && mtype && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      background: (mtype.color ?? '#8b5cf6') + '22',
                      color: mtype.color ?? '#8b5cf6',
                      border: `1px solid ${(mtype.color ?? '#8b5cf6')}33`,
                    }}
                  >
                    {mtype.name}
                  </span>
                )}
                {importance !== 'compact' && m.calendarSource && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      background: (SOURCE_COLOR[m.calendarSource] ?? '#7a89ab') + '22',
                      color: SOURCE_COLOR[m.calendarSource] ?? '#7a89ab',
                      border: `1px solid ${(SOURCE_COLOR[m.calendarSource] ?? '#7a89ab')}33`,
                    }}
                  >
                    {SOURCE_LABEL[m.calendarSource] ?? m.calendarSource}
                  </span>
                )}
                {importance !== 'compact' && m.source && m.source !== 'calendar' && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      background: '#8b5cf6' + '22',
                      color: '#8b5cf6',
                      border: '1px solid #8b5cf633',
                    }}
                    title={`Source: ${m.source}`}
                  >
                    {MEETING_SOURCE_ICONS[m.source] || ''} {MEETING_SOURCE_LABELS[m.source] || m.source}
                  </span>
                )}
              </div>
              <div className="flex gap-3 items-center flex-wrap">
                <span className={`${importance === 'compact' ? 'text-[11px]' : 'text-xs'} text-[#647399]`}>
                  📅 {new Date(m.date + 'T00:00:00').toLocaleDateString('he-IL')}
                  {importance === 'urgent' && (
                    <span className="font-semibold ml-1">· {m.time}</span>
                  )}
                  {importance !== 'urgent' && importance !== 'compact' && ` · ${m.time}`}
                </span>
                {importance !== 'compact' && m.recurring && (
                  <span className="pill">↻ {DAYS_HE[m.recurrenceDay ?? ''] ?? 'שבועי'}</span>
                )}
                {importance !== 'compact' && (
                  <span className="text-xs text-[#647399]">◻ {(m.taskIds ?? []).length} משימות</span>
                )}
              </div>
            </div>
            <div className="flex gap-1 shrink-0 mr-3">
              {(m.peopleIds ?? [])
                .slice(0, importance === 'compact' ? 2 : undefined)
                .map((pid) => {
                  const p = getPerson(pid)
                  return p ? (
                    <div
                      key={pid}
                      className="avatar border-[1.5px]"
                      style={{
                        background: (p.color ?? '#2dd4bf') + '22',
                        color: p.color ?? '#2dd4bf',
                        borderColor: (p.color ?? '#2dd4bf') + '33',
                      }}
                    >
                      {p.name[0]}
                    </div>
                  ) : null
                })}
            </div>
          </div>
        </div>
      </Link>
      {importance !== 'compact' && (
        <div className="absolute top-1/2 -translate-y-1/2 left-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onEdit && (
            <button
              onClick={(e) => {
                e.preventDefault()
                onEdit()
              }}
              className="text-[#647399] hover:text-[#b8c4dc] transition-colors p-1.5 rounded-lg hover:bg-[#1e1e1e]"
              title="ערוך"
            >
              ✏
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.preventDefault()
                if (confirm('למחוק את הפגישה?')) {
                  onDelete()
                }
              }}
              className="text-[#fb7185] hover:text-[#fda4af] transition-colors p-1.5 rounded-lg hover:bg-[#1e1e1e]"
              title="מחק"
            >
              🗑
            </button>
          )}
        </div>
      )}
    </div>
  )
}
