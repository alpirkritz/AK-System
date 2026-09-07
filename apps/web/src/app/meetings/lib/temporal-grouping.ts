import { 
  isSameDay, 
  isToday, 
  isTomorrow, 
  isThisWeek, 
  isAfter, 
  addDays,
  startOfWeek,
  endOfWeek,
  isBefore
} from 'date-fns'

export interface Meeting {
  id: string
  date: string
  [key: string]: any
}

export interface GroupedMeetings {
  today: Meeting[]
  tomorrow: Meeting[]
  thisWeek: Meeting[]
  nextWeek: Meeting[]
  later: Meeting[]
}

/**
 * Groups meetings into temporal buckets: today, tomorrow, this week, next week, later.
 * 
 * @param meetings - Array of meetings with date strings
 * @returns Grouped meetings object
 */
export function groupMeetingsByTime(meetings: Meeting[]): GroupedMeetings {
  const now = new Date()
  const tomorrowDate = addDays(now, 1)
  const weekEnd = endOfWeek(now, { weekStartsOn: 0 }) // Sunday
  const nextWeekStart = addDays(weekEnd, 1)
  const nextWeekEnd = endOfWeek(nextWeekStart, { weekStartsOn: 0 })

  const grouped: GroupedMeetings = {
    today: [],
    tomorrow: [],
    thisWeek: [],
    nextWeek: [],
    later: []
  }

  for (const meeting of meetings) {
    const meetingDate = new Date(meeting.date)

    if (isToday(meetingDate)) {
      grouped.today.push(meeting)
    } else if (isTomorrow(meetingDate)) {
      grouped.tomorrow.push(meeting)
    } else if (isThisWeek(meetingDate, { weekStartsOn: 0 }) && !isSameDay(meetingDate, now) && !isSameDay(meetingDate, tomorrowDate)) {
      grouped.thisWeek.push(meeting)
    } else if (isAfter(meetingDate, weekEnd) && (isBefore(meetingDate, nextWeekEnd) || isSameDay(meetingDate, nextWeekEnd))) {
      grouped.nextWeek.push(meeting)
    } else if (isAfter(meetingDate, nextWeekEnd)) {
      grouped.later.push(meeting)
    }
  }

  return grouped
}

/**
 * Filters meetings to only include those happening today.
 */
export function getTodayMeetings(meetings: Meeting[]): Meeting[] {
  return meetings.filter(m => isToday(new Date(m.date)))
}

/**
 * Filters meetings to only include those happening this week (next 7 days).
 */
export function getThisWeekMeetings(meetings: Meeting[]): Meeting[] {
  const now = new Date()
  const weekEnd = endOfWeek(now, { weekStartsOn: 0 })
  
  return meetings.filter(m => {
    const date = new Date(m.date)
    return (isSameDay(date, now) || isAfter(date, now)) && 
           (isSameDay(date, weekEnd) || isBefore(date, weekEnd))
  })
}
