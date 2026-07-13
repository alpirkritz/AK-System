import { createTrpcClient } from './trpc'

export type MobilePerson = {
  id: string
  name: string
  color?: string | null
  role?: string | null
  company?: string | null
}

export type MobileTask = {
  id: string
  title: string
  done: boolean
  priority: 'high' | 'medium' | 'low'
  dueDate?: string | null
  meetingId?: string | null
  projectId?: string | null
}

export type MobileMeeting = {
  id: string
  title: string
  date: string
  time: string
  recurring?: string | null
  recurrenceDay?: string | null
  peopleIds?: string[]
  taskIds?: string[]
}

export async function fetchPeople(token: string): Promise<MobilePerson[]> {
  const client = createTrpcClient(token)
  return (await client.people.list.query()) as MobilePerson[]
}

export async function fetchTasks(token: string): Promise<MobileTask[]> {
  const client = createTrpcClient(token)
  return (await client.tasks.list.query()) as MobileTask[]
}

export async function toggleTaskDone(token: string, id: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.tasks.toggleDone.mutate({ id })
}

export async function fetchMeetings(token: string): Promise<MobileMeeting[]> {
  const client = createTrpcClient(token)
  return (await client.meetings.list.query()) as MobileMeeting[]
}
