'use client'

import { useState } from 'react'

interface TimelineSectionProps {
  title: string
  count: number
  defaultExpanded?: boolean
  children: React.ReactNode
}

export function TimelineSection({ 
  title, 
  count, 
  defaultExpanded = false, 
  children 
}: TimelineSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  if (count === 0) return null

  const handleToggle = () => {
    setIsExpanded(!isExpanded)
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
