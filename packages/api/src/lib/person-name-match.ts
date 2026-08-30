/** Hebrew ↔ Latin first-name aliases for meeting/person queries. */
const NAME_ALIASES: Record<string, string[]> = {
  שני: ['shani'],
  shani: ['שני'],
}

/** Expand a user query into lowercase match variants (aliases + tokens). */
export function expandNameQuery(query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out = new Set<string>()
  const add = (raw: string) => {
    const v = raw.trim().toLowerCase()
    if (v.length < 2) return
    out.add(v)
    const mapped = NAME_ALIASES[v]
    if (mapped) {
      out.add(v)
      for (const a of mapped) out.add(a.toLowerCase())
    }
    for (const [k, aliases] of Object.entries(NAME_ALIASES)) {
      if (aliases.some((a) => a.toLowerCase() === v)) out.add(k.toLowerCase())
    }
  }
  add(q)
  for (const token of q.split(/\s+/)) add(token)
  return [...out]
}

export function queryMatchesText(hay: string, query: string): boolean {
  const h = (hay || '').toLowerCase()
  if (!h.trim()) return false
  return expandNameQuery(query).some((v) => h.includes(v))
}

export function queryMatchesPersonName(name: string, query: string): boolean {
  return queryMatchesText(name, query)
}

/** True when both titles mention the same known person (first/last token ≥ 4 chars). */
export function titlesShareKnownPerson(a: string, b: string, knownNames: string[]): boolean {
  const tokens = new Set<string>()
  for (const name of knownNames) {
    for (const t of (name || '').toLowerCase().split(/\s+/)) {
      if (t.length >= 4) tokens.add(t)
    }
  }
  const na = (a || '').toLowerCase()
  const nb = (b || '').toLowerCase()
  for (const t of tokens) {
    if (na.includes(t) && nb.includes(t)) return true
  }
  return false
}
