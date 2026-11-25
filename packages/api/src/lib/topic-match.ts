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

/** `4`, `4.0` and `v4` are the same version. */
function versionKey(raw: string): string {
  return raw.toLowerCase().replace(/^v/, '').replace(/(?:\.0+)+$/, '')
}

/**
 * Each distinctive token with the version written straight after it, or null.
 * `Algo 4.0 Sync` gives algo → "4"; `Algo core sync` gives algo → null, core → null.
 */
function topicVersions(title: string): Map<string, string | null> {
  const rawParts = title
    .replace(/[^\p{L}\p{N}.\s]/gu, ' ')
    .split(/\s+/)
    .map((raw) => raw.trim().replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
  const out = new Map<string, string | null>()
  rawParts.forEach((trimmed, index) => {
    const lower = trimmed.toLowerCase()
    if (TOPIC_STOP.has(lower) || VERSION_TOKEN.test(lower)) return
    const isAcronym = /^[A-Z]{2,3}$/.test(trimmed)
    if (lower.length < 4 && !isAcronym) return
    const next = rawParts[index + 1]
    const version = next && VERSION_TOKEN.test(next) ? versionKey(next) : null
    if (!out.has(lower) || (out.get(lower) === null && version !== null)) out.set(lower, version)
  })
  return out
}

/**
 * Distinctive tokens from a meeting or task title.
 * Generic words, bare numbers, and version fragments are dropped.
 * A 2–3 letter token is kept only when it is an all-caps Latin acronym (DD).
 */
export function topicTokens(title: string): string[] {
  return [...topicVersions(title).keys()]
}

/**
 * True when two titles share a topic token that means the same thing in both.
 * A version is part of the name: `Algo 4.0` and `Algo 4` are one topic, while
 * `Algo 4.0` and plain `Algo` are two different projects and do not match on `algo`.
 */
export function titlesShareTopic(a: string, b: string): boolean {
  const right = topicVersions(b)
  for (const [token, version] of topicVersions(a)) {
    if (right.has(token) && right.get(token) === version) return true
  }
  return false
}
