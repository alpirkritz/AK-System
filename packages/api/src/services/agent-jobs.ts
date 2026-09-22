/**
 * Agent Jobs Queue — async processing for WhatsApp and Telegram messages.
 * Decouples webhook response from agent processing to prevent timeouts.
 */
import { getDb, agentJobs, type NewAgentJob, type AgentJob } from '@ak-system/database'
import { randomBytes } from 'node:crypto'
import { eq, and, lte, sql } from 'drizzle-orm'

function genId(): string {
  return randomBytes(12).toString('base64url')
}

export interface AgentJobPayload {
  message: string
  from: string
  chatJid: string
  messageId?: string
  [key: string]: unknown
}

export interface CreateJobOptions {
  channel: 'whatsapp' | 'telegram'
  agentId: string
  payload: AgentJobPayload
  dedupeKey?: string // defaults to messageId from payload
}

/**
 * Create a new agent job (idempotent via dedupeKey).
 */
export async function createAgentJob(options: CreateJobOptions): Promise<{ jobId: string; created: boolean }> {
  const db = getDb()
  const dedupeKey = options.dedupeKey || options.payload.messageId || genId()

  // Check if job already exists
  const existing = await db
    .select({ id: agentJobs.id })
    .from(agentJobs)
    .where(eq(agentJobs.dedupeKey, dedupeKey))
    .limit(1)

  if (existing.length > 0) {
    return { jobId: existing[0]!.id, created: false }
  }

  // Create new job
  const jobId = genId()
  const now = new Date().toISOString()

  const newJob: NewAgentJob = {
    id: jobId,
    dedupeKey,
    channel: options.channel,
    agentId: options.agentId,
    payload: JSON.stringify(options.payload),
    status: 'pending',
    attempts: 0,
    nextRunAt: now, // ready immediately
    lastError: null,
    createdAt: now,
    completedAt: null,
  }

  await db.insert(agentJobs).values(newJob)

  return { jobId, created: true }
}

/**
 * Get pending jobs that are ready to run.
 */
export async function getPendingJobs(limit = 10): Promise<AgentJob[]> {
  const db = getDb()
  const now = new Date().toISOString()

  const rows = await db
    .select()
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.status, 'pending'),
        lte(agentJobs.nextRunAt, now)
      )
    )
    .orderBy(agentJobs.nextRunAt)
    .limit(limit)

  return rows as AgentJob[]
}

/**
 * Mark a job as running.
 */
export async function markJobRunning(jobId: string): Promise<void> {
  const db = getDb()
  await db
    .update(agentJobs)
    .set({
      status: 'running',
      attempts: sql`${agentJobs.attempts} + 1`,
    })
    .where(eq(agentJobs.id, jobId))
}

/**
 * Mark a job as done.
 */
export async function markJobDone(jobId: string): Promise<void> {
  const db = getDb()
  const now = new Date().toISOString()

  await db
    .update(agentJobs)
    .set({
      status: 'done',
      completedAt: now,
      lastError: null,
    })
    .where(eq(agentJobs.id, jobId))
}

/**
 * Mark a job as failed and schedule retry.
 */
export async function markJobFailed(jobId: string, error: string, attempt: number): Promise<void> {
  const db = getDb()
  const maxAttempts = 3
  const shouldRetry = attempt < maxAttempts

  if (shouldRetry) {
    // Exponential backoff: 1min, 5min, 15min
    const delayMinutes = attempt === 1 ? 1 : attempt === 2 ? 5 : 15
    const nextRunAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString()

    await db
      .update(agentJobs)
      .set({
        status: 'pending',
        nextRunAt,
        lastError: error,
      })
      .where(eq(agentJobs.id, jobId))
  } else {
    // Final failure
    const now = new Date().toISOString()
    await db
      .update(agentJobs)
      .set({
        status: 'failed',
        lastError: error,
        completedAt: now,
      })
      .where(eq(agentJobs.id, jobId))
  }
}

/**
 * Get job by ID.
 */
export async function getJob(jobId: string): Promise<AgentJob | null> {
  const db = getDb()
  const rows = await db.select().from(agentJobs).where(eq(agentJobs.id, jobId)).limit(1)
  return rows[0] ? (rows[0] as AgentJob) : null
}
