const TOPIC_STOP = new Set(
  [
    'follow',
    'up',
    'meeting',
    'sync',
    'weekly',
    'daily',
    'standup',
    'the',
    'and',
    'for',
    'with',
    'from',
    'into',
    'about',
    'this',
    'that',
    'next',
    'last',
    'connect',
    'release',
    'discussion',
    'update',
    'updates',
    'milestone',
    'milestones',
    'timeline',
    'timelines',
    'status',
    'review',
    'prep',
    'followup',
    'פגישה',
    'עדכון',
    'סטטוס',
    'שחרור',
    'דיון',
    'סנכרון',
  ],
)

const VERSION_TOKEN = /^(?:v)?\d+(?:\.\d+)*$/i

/**
 * Distinctive tokens from a meeting or task title.
 * Generic words, bare numbers, and version fragments are dropped.
 * A 2–3 letter token is kept only when it is an all-caps Latin acronym (DD).
 */
export function topicTokens(title: string): string[] {
  const rawParts = title.replace(/[^\p{L}\p{N}.\s]/gu, ' ').split(/\s+/)
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of rawParts) {
    const trimmed = raw.trim().replace(/^\.+|\.+$/g, '')
    if (!trimmed) continue
    const lower = trimmed.toLowerCase()
    if (TOPIC_STOP.has(lower) || VERSION_TOKEN.test(lower)) continue
    const isAcronym = /^[A-Z]{2,3}$/.test(trimmed)
    if (lower.length < 4 && !isAcronym) continue
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(lower)
  }
  return out
}

/** True when two titles share at least one topic token. */
export function titlesShareTopic(a: string, b: string): boolean {
  const right = new Set(topicTokens(b))
  return topicTokens(a).some((token) => right.has(token))
}
