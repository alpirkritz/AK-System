'use client'

interface QuickFilterButtonProps {
  active: boolean
  count?: number
  children: React.ReactNode
  onClick: () => void
}

export function QuickFilterButton({ 
  active, 
  count, 
  children, 
  onClick 
}: QuickFilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`btn relative px-4 py-2 ${active ? 'quick-filter-active' : 'btn-ghost'}`}
      aria-pressed={active}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span className="filter-badge">
          {count}
        </span>
      )}
    </button>
  )
}
