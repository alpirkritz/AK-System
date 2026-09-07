export interface SearchableMeeting {
  id: string
  title: string
  people?: Array<{ name: string }>
  project?: { name: string } | null
  [key: string]: any
}

/**
 * Filters meetings by search query across title, participants, and project name.
 * Search is case-insensitive and matches partial strings.
 * 
 * @param meetings - Array of meetings to search
 * @param query - Search query string
 * @returns Filtered array of meetings
 */
export function searchMeetings(
  meetings: SearchableMeeting[], 
  query: string
): SearchableMeeting[] {
  if (!query.trim()) return meetings
  
  const lowerQuery = query.toLowerCase().trim()
  
  return meetings.filter(meeting => {
    // Search in title
    if (meeting.title?.toLowerCase().includes(lowerQuery)) {
      return true
    }
    
    // Search in participants
    if (meeting.people?.some(p => p.name?.toLowerCase().includes(lowerQuery))) {
      return true
    }
    
    // Search in project
    if (meeting.project?.name?.toLowerCase().includes(lowerQuery)) {
      return true
    }
    
    return false
  })
}
