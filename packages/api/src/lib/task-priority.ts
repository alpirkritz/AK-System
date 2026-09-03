/**
 * Derive task priority from action item content.
 * Checks for urgent keywords in Hebrew and English.
 *
 * @param content - Action item content/text
 * @returns 'high' if urgent keywords found, 'medium' otherwise
 */
export function derivePriorityFromContext(content: string): 'high' | 'medium' | 'low' {
  const lower = content.toLowerCase()
  const urgentKeywords = [
    'דחוף',
    'urgent',
    'asap',
    'היום',
    'עכשיו',
    'מיידי',
    'critical',
    'today',
    'now',
    'immediately',
  ]
  return urgentKeywords.some((kw) => lower.includes(kw)) ? 'high' : 'medium'
}
