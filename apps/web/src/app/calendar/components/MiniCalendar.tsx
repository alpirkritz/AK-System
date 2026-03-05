import { useMemo } from 'react'
import { HE_DAYS } from '../lib/constants'
import { isToday, isoDate } from '../lib/date-utils'

interface MiniCalendarProps {
  month: number
  year: number
  selectedDate?: Date
  onSelectDate: (d: Date) => void
  onChangeMonth: (month: number, year: number) => void
}

export default function MiniCalendar({
  month,
  year,
  selectedDate,
  onSelectDate,
  onChangeMonth,
}: MiniCalendarProps) {
  const cells = useMemo(() => {
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const result: (Date | null)[] = [
      ...Array(firstDay.getDay()).fill(null),
      ...Array.from({ length: lastDay.getDate() }, (_, i) => new Date(year, month, i + 1)),
    ]
    while (result.length % 7 !== 0) result.push(null)
    return result
  }, [month, year])

  const prevMonth = () => {
    const m = month === 0 ? 11 : month - 1
    const y = month === 0 ? year - 1 : year
    onChangeMonth(m, y)
  }

  const nextMonth = () => {
    const m = month === 11 ? 0 : month + 1
    const y = month === 11 ? year + 1 : year
    onChangeMonth(m, y)
  }

  const HE_MONTHS_SHORT = [
    'ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני',
    'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳',
  ]

  return (
    <div className="px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={nextMonth}
          className="w-6 h-6 flex items-center justify-center rounded text-[#555]
            hover:text-[#ccc] hover:bg-[#161616] transition-colors
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c547]/60"
          aria-label="חודש הבא"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="text-[11px] font-medium text-[#888] select-none">
          {HE_MONTHS_SHORT[month]} {year}
        </span>
        <button
          onClick={prevMonth}
          className="w-6 h-6 flex items-center justify-center rounded text-[#555]
            hover:text-[#ccc] hover:bg-[#161616] transition-colors
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c547]/60"
          aria-label="חודש קודם"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
            <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0">
        {HE_DAYS.map((d) => (
          <div key={d} className="text-center text-[9px] text-[#444] py-1 select-none">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const today = isToday(day)
          const selected = selectedDate && isoDate(day) === isoDate(selectedDate)
          return (
            <button
              key={i}
              onClick={() => onSelectDate(day)}
              className={`w-6 h-6 mx-auto flex items-center justify-center rounded-full text-[10px]
                transition-all duration-100
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c547]/60
                ${today
                  ? 'bg-[#e8c547] text-black font-bold'
                  : selected
                    ? 'bg-[#e8c547]/15 text-[#e8c547] font-medium'
                    : 'text-[#777] hover:bg-[#1a1a1a] hover:text-[#ccc]'
                }`}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
