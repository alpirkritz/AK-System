import { useState } from 'react'
import type { CalendarMeta } from '../lib/types'
import CalendarCheckbox from './CalendarCheckbox'
import MiniCalendar from './MiniCalendar'

interface CalendarSidebarProps {
  calendars: CalendarMeta[]
  selected: Set<string>
  onToggle: (id: string) => void
  loading: boolean
  selectedDate?: Date
  onSelectDate: (d: Date) => void
}

export default function CalendarSidebar({
  calendars,
  selected,
  onToggle,
  loading,
  selectedDate,
  onSelectDate,
}: CalendarSidebarProps) {
  const today = new Date()
  const [miniMonth, setMiniMonth] = useState(today.getMonth())
  const [miniYear, setMiniYear] = useState(today.getFullYear())

  const allSelected = calendars.length > 0 && calendars.every((c) => selected.has(c.id))
  const noneSelected = calendars.every((c) => !selected.has(c.id))

  const toggleAll = () => {
    if (allSelected) calendars.forEach((c) => selected.has(c.id) && onToggle(c.id))
    else calendars.forEach((c) => !selected.has(c.id) && onToggle(c.id))
  }

  const googleCals = calendars.filter((c) => c.source === 'google')
  const appleCals = calendars.filter((c) => c.source === 'apple')

  return (
    <div className="w-56 shrink-0 border-r border-[#1a1a1a] bg-[#070707] flex flex-col overflow-hidden">
      {/* Mini calendar for quick navigation */}
      <MiniCalendar
        month={miniMonth}
        year={miniYear}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        onChangeMonth={(m, y) => {
          setMiniMonth(m)
          setMiniYear(y)
        }}
      />

      <div className="border-t border-[#141414]" />

      {/* Calendar sources header */}
      <div className="px-3 pt-3 pb-1.5 flex items-center justify-between shrink-0">
        <span className="text-[10px] font-semibold text-[#444] uppercase tracking-widest">
          יומנים
        </span>
        {!loading && calendars.length > 1 && (
          <button
            onClick={toggleAll}
            className="text-[10px] text-[#555] hover:text-[#aaa] transition-colors px-1.5 py-0.5 rounded
              hover:bg-[#141414]
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c547]/60"
          >
            {allSelected ? 'הסתר הכל' : noneSelected ? 'הצג הכל' : 'בחר הכל'}
          </button>
        )}
      </div>

      {/* Calendar list */}
      <div className="flex-1 overflow-y-auto py-1 px-1">
        {loading && (
          <div className="space-y-1 px-2">
            {[100, 72, 130, 88, 110].map((w, i) => (
              <div key={i} className="flex items-center gap-2.5 py-2">
                <div className="w-3.5 h-3.5 rounded bg-[#1e1e1e] shrink-0 animate-pulse" />
                <div className="h-3 bg-[#1a1a1a] rounded animate-pulse" style={{ width: w }} />
              </div>
            ))}
          </div>
        )}

        {!loading && googleCals.length > 0 && (
          <div className="mb-1">
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span className="text-[9px] text-[#444] uppercase tracking-wider font-medium">Google</span>
            </div>
            {googleCals.map((cal) => (
              <CalendarCheckbox key={cal.id} cal={cal} checked={selected.has(cal.id)} onToggle={onToggle} />
            ))}
          </div>
        )}

        {!loading && appleCals.length > 0 && (
          <div>
            {googleCals.length > 0 && <div className="mx-2 my-1.5 border-t border-[#141414]" />}
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="#888">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
              <span className="text-[9px] text-[#444] uppercase tracking-wider font-medium">Exchange / Mac</span>
            </div>
            {appleCals.map((cal) => (
              <CalendarCheckbox key={cal.id} cal={cal} checked={selected.has(cal.id)} onToggle={onToggle} />
            ))}
          </div>
        )}

        {!loading && calendars.length === 0 && (
          <p className="text-[11px] text-[#333] px-3 py-4 text-center">אין יומנים</p>
        )}
      </div>

      {/* RSVP legend at the bottom */}
      <div className="border-t border-[#141414] px-3 py-2.5">
        <div className="text-[9px] text-[#3a3a3a] uppercase tracking-widest mb-1.5 font-medium">מקרא</div>
        <div className="grid grid-cols-2 gap-y-1 gap-x-2">
          {([
            { color: '#4ade80', label: 'אישרתי' },
            { color: '#fbbf24', label: 'אולי' },
            { color: '#94a3b8', label: 'ממתין' },
            { color: '#f87171', label: 'דחיתי' },
          ]).map((item) => (
            <span key={item.label} className="flex items-center gap-1.5 text-[10px] text-[#555]">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
