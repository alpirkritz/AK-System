export interface SuggestPerson {
  id: string
  name: string
  company?: string | null
  role?: string | null
}

export interface SuggestMeeting {
  date: string
  peopleIds: string[]
}

/** Distinct attendees from the newest meetings, skipping anyone already selected. */
export function recentPersonIds(
  meetings: SuggestMeeting[],
  knownIds: ReadonlySet<string>,
  selectedIds: readonly string[],
  limit = 6,
): string[] {
  const selected = new Set(selectedIds)
  const sorted = [...meetings].sort((a, b) => b.date.localeCompare(a.date))
  const out: string[] = []
  const seen = new Set<string>()
  for (const meeting of sorted) {
    for (const id of meeting.peopleIds) {
      if (seen.has(id) || selected.has(id) || !knownIds.has(id)) continue
      seen.add(id)
      out.push(id)
      if (out.length >= limit) return out
    }
  }
  return out
}

/** Name, company, or role. Empty query matches nobody — recents are a separate list. */
export function filterPeople(
  people: SuggestPerson[],
  selectedIds: readonly string[],
  query: string,
  limit = 8,
): SuggestPerson[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const selected = new Set(selectedIds)
  return people
    .filter((person) => !selected.has(person.id))
    .filter((person) => {
      const company = person.company ?? ''
      const role = person.role ?? ''
      return (
        person.name.toLowerCase().includes(q) ||
        company.toLowerCase().includes(q) ||
        role.toLowerCase().includes(q)
      )
    })
    .slice(0, limit)
}

/** Original name when the typed text is exactly someone already on the meeting. */
export function selectedExactName(
  people: SuggestPerson[],
  selectedIds: readonly string[],
  query: string,
): string | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const selected = new Set(selectedIds)
  const match = people.find(
    (person) => selected.has(person.id) && person.name.trim().toLowerCase() === q,
  )
  return match?.name ?? null
}
