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
  /** Canonical status; `done` is derived from it. Older rows may omit it. */
  status?: string | null
  priority: 'high' | 'medium' | 'low'
  dueDate?: string | null
  meetingId?: string | null
  projectId?: string | null
  workspaceId?: string | null
  assigneeId?: string | null
  /** 'manual' | 'notion' — Notion tasks mirror status changes back to Notion. */
  source?: string | null
  notionPageId?: string | null
  notionStatusRaw?: string | null
}

export type MobileWorkspace = {
  id: string
  name: string
  color?: string | null
}

/** Result of mirroring a status change to Notion; `null` for manual tasks. */
export type NotionSyncResult =
  | { ok: true; label: string }
  | { ok: false; reason: string; message?: string }
  | null

export type TaskInput = {
  title: string
  status?: string
  priority?: 'high' | 'medium' | 'low'
  dueDate?: string | null
  workspaceId?: string | null
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

export async function fetchTask(token: string, id: string): Promise<MobileTask | null> {
  const client = createTrpcClient(token)
  return (await client.tasks.getById.query({ id })) as MobileTask | null
}

export async function fetchWorkspaces(token: string): Promise<MobileWorkspace[]> {
  const client = createTrpcClient(token)
  return (await client.workspaces.list.query()) as MobileWorkspace[]
}

export async function createTask(token: string, input: TaskInput): Promise<MobileTask> {
  const client = createTrpcClient(token)
  return (await client.tasks.create.mutate(input)) as MobileTask
}

export async function updateTask(
  token: string,
  id: string,
  input: Partial<TaskInput>,
): Promise<MobileTask & { notionSync?: NotionSyncResult }> {
  const client = createTrpcClient(token)
  return (await client.tasks.update.mutate({ id, ...input })) as MobileTask & {
    notionSync?: NotionSyncResult
  }
}

export async function toggleTaskDone(
  token: string,
  id: string,
): Promise<MobileTask & { notionSync?: NotionSyncResult }> {
  const client = createTrpcClient(token)
  return (await client.tasks.toggleDone.mutate({ id })) as MobileTask & {
    notionSync?: NotionSyncResult
  }
}

export async function fetchMeetings(token: string): Promise<MobileMeeting[]> {
  const client = createTrpcClient(token)
  return (await client.meetings.list.query()) as MobileMeeting[]
}
