export const colors = {
  bg: '#0e1626',
  surface: '#16233b',
  surfaceCard: '#1a2740',
  border: '#2f4368',
  // `gold` kept as the accent key for backward compat; value is now turquoise.
  gold: '#2dd4bf',
  goldDim: '#14b8a6',
  accent: '#2dd4bf',
  coral: '#fb7185',
  success: '#34d399',
  info: '#38bdf8',
  text: '#eef3fb',
  textMuted: '#97a4c2',
  userBubble: '#14324a',
  assistantBubble: '#1a2740',
  error: '#fb7185',
}

export const layout = {
  maxContentWidth: 720,
  coverMaxWidth: 380,
}

export const PRIORITY_COLOR: Record<string, string> = {
  high: '#fb7185',
  medium: '#2dd4bf',
  low: '#38bdf8',
}

export const PRIORITY_LABEL: Record<string, string> = {
  high: 'גבוהה',
  medium: 'בינונית',
  low: 'נמוכה',
}

/**
 * Canonical task statuses, mirroring `@ak-system/types`. Duplicated rather than imported so the
 * Metro bundler never has to resolve a workspace package (same precedent as PRIORITY_* above).
 * Keep in sync with packages/types/src/index.ts.
 */
export const STATUS_ORDER = [
  'not_started',
  'pending',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
] as const

export type StatusKey = (typeof STATUS_ORDER)[number]

export const STATUS_COLOR: Record<string, string> = {
  not_started: '#7a89ab',
  pending: '#f472b6',
  in_progress: '#38bdf8',
  blocked: '#f59e0b',
  done: '#2dd4bf',
  cancelled: '#9a7bc4',
}

export const STATUS_LABEL: Record<string, string> = {
  not_started: 'לא התחיל',
  pending: 'בהמתנה',
  in_progress: 'בתהליך',
  blocked: 'חסום',
  done: 'הושלם',
  cancelled: 'בוטל',
}
