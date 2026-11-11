'use client'

import { useState } from 'react'

interface TimelineSectionProps {
  title: string
  count: number
  defaultExpanded?: boolean
  /** The owner's saved open/closed choice; wins over `defaultExpanded` when set. */
  expanded?: boolean
  onToggle?: (open: boolean) => void
  children: React.ReactNode
}

export function TimelineSection({ 
  title, 
  count, 
  defaultExpanded = false, 
  expanded,
  onToggle,
  children 
}: TimelineSectionProps) {
  // `expanded` is the owner's saved choice; without one the section follows its default.
  const [isExpanded, setIsExpanded] = useState(expanded ?? defaultExpanded)

  if (count === 0) return null

  const handleToggle = () => {
    setIsExpanded(!isExpanded)
    onToggle?.(!isExpanded)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleToggle()
    }
  }

  return (
    <div className="mb-6">
      <div
        className="timeline-section-header"
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
      >
        <span className={`transform transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}>
          ◂
        </span>
        <span>{title}</span>
        <span className="text-[var(--text-muted)] text-xs">({count})</span>
      </div>
      {isExpanded && (
        <div className="timeline-section-content space-y-3 mt-3">
          {children}
        </div>
      )}
    </div>
  )
}
