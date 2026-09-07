/**
 * Format meeting titles - detect and format ISO timestamp titles into readable Hebrew format
 */

/**
 * Check if a title is an ISO timestamp (e.g., "2026-08-11T10:26:00.000+03:00")
 */
function isTimestampTitle(title: string): boolean {
  return /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(title)
}

/**
 * Format a timestamp title into readable Hebrew format
 * "2026-08-11T10:26:00.000+03:00" → "11 באוגוסט 2026, 10:26"
 */
function formatTimestampTitle(title: string): string {
  try {
    const date = new Date(title)
    
    // Format: "11 באוגוסט 2026, 10:26"
    const formatted = date.toLocaleString('he-IL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    
    return formatted
  } catch {
    // If parsing fails, return original
    return title
  }
}

/**
 * Format meeting title - automatically detect and format timestamps
 */
export function formatMeetingTitle(title: string): string {
  if (isTimestampTitle(title)) {
    return formatTimestampTitle(title)
  }
  return title
}
