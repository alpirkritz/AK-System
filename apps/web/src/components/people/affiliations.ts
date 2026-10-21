import type { Person } from '@ak-system/database'

export type WorkspaceKind = 'employer' | 'own_company' | 'personal' | 'other'

/** A people-list row: the person plus every life domain they belong to. */
export type PersonWithAffiliations = Person & { affiliations?: Affiliation[] }

export interface Affiliation {
  id: string
  personId: string
  workspaceId: string
  workspaceName: string
  workspaceColor: string | null
  workspaceKind: string | null
  relationshipType: string
  reportsToPersonId: string | null
  reportsToName: string | null
  notes: string | null
}

export const WORKSPACE_KIND_OPTIONS: Array<{ value: WorkspaceKind; label: string }> = [
  { value: 'employer', label: 'מעסיק' },
  { value: 'own_company', label: 'חברה / סטארטאפ שלי' },
  { value: 'personal', label: 'אישי' },
  { value: 'other', label: 'אחר' },
]

export function workspaceKindLabel(kind: string | null | undefined): string | null {
  if (!kind) return null
  return WORKSPACE_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? kind
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  colleague: 'עמית',
  manager: 'מנהל',
  direct_report: 'כפיף',
  external: 'חיצוני',
  vendor: 'ספק',
  partner: 'שותף',
  co_founder: 'שותף מייסד',
  employee: 'עובד',
  advisor: 'יועץ',
  investor: 'משקיע',
  client: 'לקוח',
  prospect: 'לקוח פוטנציאלי',
  lecture_organizer: 'מארגן הרצאות',
  service_provider: 'נותן שירות',
  family: 'משפחה',
  friend: 'חבר',
  acquaintance: 'מכר',
}

/** Hebrew label for a suggested value; custom free text is shown as typed. */
export function relationshipLabel(value: string): string {
  return RELATIONSHIP_LABELS[value] ?? value
}

const SUGGESTIONS: Record<WorkspaceKind, string[]> = {
  employer: ['colleague', 'manager', 'direct_report', 'external', 'vendor', 'partner'],
  own_company: ['co_founder', 'employee', 'advisor', 'investor', 'client', 'prospect', 'partner', 'lecture_organizer', 'vendor', 'service_provider'],
  personal: ['family', 'friend', 'acquaintance', 'vendor', 'partner', 'service_provider'],
  other: ['partner', 'vendor', 'service_provider', 'acquaintance'],
}

/** Quick-pick chips for a workspace kind. The field stays free text. */
export function relationshipSuggestions(kind: string | null | undefined): string[] {
  return SUGGESTIONS[(kind as WorkspaceKind) ?? 'other'] ?? SUGGESTIONS.other
}
