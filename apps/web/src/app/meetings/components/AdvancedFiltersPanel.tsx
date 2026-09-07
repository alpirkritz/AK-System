'use client'

import { useState } from 'react'

interface Person {
  id: string
  name: string
}

interface Project {
  id: string
  name: string
}

interface AdvancedFilters {
  people: string[]
  status?: 'scheduled' | 'completed' | 'cancelled'
  project?: string
}

interface AdvancedFiltersPanelProps {
  allPeople: Person[]
  allProjects: Project[]
  selectedFilters: AdvancedFilters
  onApply: (filters: AdvancedFilters) => void
  onClear: () => void
}

export function AdvancedFiltersPanel({
  allPeople,
  allProjects,
  selectedFilters,
  onApply,
  onClear,
}: AdvancedFiltersPanelProps) {
  const [localFilters, setLocalFilters] = useState<AdvancedFilters>(selectedFilters)
  const [peopleDropdownOpen, setPeopleDropdownOpen] = useState(false)

  const handlePersonToggle = (personId: string) => {
    const newPeople = localFilters.people.includes(personId)
      ? localFilters.people.filter((id) => id !== personId)
      : [...localFilters.people, personId]
    
    setLocalFilters({ ...localFilters, people: newPeople })
  }

  const handleApply = () => {
    onApply(localFilters)
  }

  const handleClear = () => {
    setLocalFilters({ people: [], status: undefined, project: undefined })
    onClear()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleApply()
      }}
      className="card p-4 mt-3 space-y-3"
      style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}
    >
      {/* People filter (multi-select with checkboxes) */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-body)] mb-2">
          משתתפים
        </label>
        <div className="relative">
          <button
            type="button"
            onClick={() => setPeopleDropdownOpen(!peopleDropdownOpen)}
            className="input w-full text-right flex items-center justify-between"
          >
            <span>
              {localFilters.people.length === 0
                ? 'כל המשתתפים'
                : `${localFilters.people.length} נבחרו`}
            </span>
            <svg
              className="w-4 h-4 text-[var(--text-muted)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {peopleDropdownOpen && (
            <div
              className="absolute z-10 w-full mt-1 card p-2 max-h-60 overflow-y-auto"
              style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}
            >
              {allPeople.map((person) => (
                <label
                  key={person.id}
                  className="flex items-center gap-2 p-2 hover:bg-[var(--surface-hover)] rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={localFilters.people.includes(person.id)}
                    onChange={() => handlePersonToggle(person.id)}
                    className="accent-[var(--accent)]"
                  />
                  <span className="text-sm">{person.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Status filter */}
      <div>
        <label htmlFor="status-filter" className="block text-sm font-medium text-[var(--text-body)] mb-2">
          סטטוס
        </label>
        <select
          id="status-filter"
          className="input w-full"
          value={localFilters.status ?? ''}
          onChange={(e) =>
            setLocalFilters({
              ...localFilters,
              status: e.target.value ? (e.target.value as AdvancedFilters['status']) : undefined,
            })
          }
        >
          <option value="">כולם</option>
          <option value="scheduled">נקבעה</option>
          <option value="completed">התקיימה</option>
          <option value="cancelled">בוטלה</option>
        </select>
      </div>

      {/* Project filter */}
      <div>
        <label htmlFor="project-filter" className="block text-sm font-medium text-[var(--text-body)] mb-2">
          פרויקט
        </label>
        <select
          id="project-filter"
          className="input w-full"
          value={localFilters.project ?? ''}
          onChange={(e) =>
            setLocalFilters({
              ...localFilters,
              project: e.target.value || undefined,
            })
          }
        >
          <option value="">כל הפרויקטים</option>
          {allProjects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 justify-end pt-2">
        <button type="button" onClick={handleClear} className="btn btn-ghost">
          אפס
        </button>
        <button type="submit" className="btn btn-primary">
          החל
        </button>
      </div>
    </form>
  )
}
