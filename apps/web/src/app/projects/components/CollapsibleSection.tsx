'use client'

import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * Generic collapsible section header + `.card` content wrapper.
 * Used on the project detail page for the meeting-notes block; kept
 * generic (no meeting-notes-specific naming) so other sections can
 * reuse the same pattern later.
 */
export function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string
  count?: number
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()

  return (
    <div className="mb-6">
      <button
        type="button"
        className="w-full flex justify-between items-center mb-3 group text-right"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-xs font-semibold text-[#5a688c] uppercase tracking-wider group-hover:text-[#7a89ab] transition-colors">
          {title}
          {typeof count === 'number' ? ` (${count})` : ''}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-[#5a688c] transition-transform group-hover:text-[#7a89ab] ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <div id={contentId} className="card space-y-2">
          {children}
        </div>
      )}
    </div>
  )
}
