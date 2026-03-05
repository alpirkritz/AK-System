import type { CalendarMeta } from '../lib/types'

interface CalendarCheckboxProps {
  cal: CalendarMeta
  checked: boolean
  onToggle: (id: string) => void
}

export default function CalendarCheckbox({ cal, checked, onToggle }: CalendarCheckboxProps) {
  return (
    <button
      onClick={() => onToggle(cal.id)}
      title={checked ? `הסתר: ${cal.name}` : `הצג: ${cal.name}`}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-right transition-colors rounded-md
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c547]/60
        ${checked ? 'text-[#ccc] hover:bg-[#141414]' : 'text-[#444] hover:bg-[#0e0e0e]'}`}
    >
      <span
        className="w-3.5 h-3.5 rounded shrink-0 flex items-center justify-center transition-all duration-150"
        style={{
          background: checked ? cal.color : 'transparent',
          border: `2px solid ${checked ? cal.color : '#333'}`,
        }}
      >
        {checked && (
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path
              d="M1.5 4L3.5 6L6.5 2"
              stroke="black"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="text-xs truncate leading-tight">{cal.name}</span>
    </button>
  )
}
