import { getDb } from '@ak-system/database'
import {
  people,
  meetings,
  meetingPeople,
  meetingNotes,
  meetingNotePeople,
  meetingNoteProjects,
  projects,
  projectPeople,
  meetingAnalyses,
  meetingPreps,
  meetingSeries,
  meetingTypes,
  tasks,
  workspaces,
  workspaceNotionDatabases,
  peopleNotionSources,
  notionStatusOverrides,
  seriesRoster,
  meetingRosterExceptions,
  whatsappPersonLinks,
  duplicateReviews,
  commitments,
  personTraitEvidence,
  personTraits,
  personObservations,
  personSourceScans,
  whatsappDmSummaries,
  whatsappDmMessages,
  personEmailThreads,
  voiceRecordingPeople,
  voiceSpeakerIdentities,
  voiceTranscriptSegments,
  voiceRecordings,
  voicePrints,
  harnessNodes,
  harnessEdges,
  harnessInsights,
} from '@ak-system/database'
import { appRouter } from './index'
import { createContext, createCallerFactory } from './trpc'

export function getTestDb() {
  return getDb()
}

const TEST_SESSION = { user: { id: 'test-user', email: 'test@test.com', name: 'Test User' } }

export async function createTestCaller() {
  const db = getTestDb()
  const ctx = await createContext({ db, session: TEST_SESSION })
  const createCaller = createCallerFactory(appRouter)
  return createCaller(ctx)
}

/**
 * Clear all tables so tests don't depend on each other. Call in beforeEach.
 * Workspaces are wiped too; the next `getDb()` re-seeds the four defaults.
 */
export async function resetDb() {
  const db = getTestDb()
  await db.delete(harnessInsights)
  await db.delete(harnessEdges)
  await db.delete(harnessNodes)
  await db.delete(personTraitEvidence)
  await db.delete(personTraits)
  await db.delete(personObservations)
  await db.delete(personSourceScans)
  await db.delete(commitments)
  await db.delete(personEmailThreads)
  await db.delete(voicePrints)
  await db.delete(voiceSpeakerIdentities)
  await db.delete(voiceTranscriptSegments)
  await db.delete(voiceRecordingPeople)
  await db.delete(voiceRecordings)
  await db.delete(whatsappDmSummaries)
  await db.delete(whatsappDmMessages)
  await db.delete(meetingRosterExceptions)
  await db.delete(seriesRoster)
  await db.delete(whatsappPersonLinks)
  await db.delete(duplicateReviews)
  await db.delete(tasks)
  await db.delete(meetingPreps)
  await db.delete(meetingAnalyses)
  await db.delete(meetingNotePeople)
  await db.delete(meetingNoteProjects)
  await db.delete(projectPeople)
  await db.delete(projects)
  await db.delete(meetingNotes)
  await db.delete(meetingPeople)
  await db.delete(meetings)
  await db.delete(meetingSeries)
  await db.delete(meetingTypes)
  await db.delete(people)
  await db.delete(notionStatusOverrides)
  await db.delete(workspaceNotionDatabases)
  await db.delete(peopleNotionSources)
  await db.delete(workspaces)
}
