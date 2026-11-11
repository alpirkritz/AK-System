import { getDb, agentRunLogs, type NewAgentRunLog } from '@ak-system/database'
import { randomBytes } from 'node:crypto'

function genId(): string {
  return randomBytes(12).toString('base64url')
}

export interface AgentRunLogData {
  runId: string
  agentId: string
  channel: 'web' | 'whatsapp' | 'telegram' | 'cron'
  priority: 'interactive' | 'event' | 'batch'
  status: 'ok' | 'degraded' | 'empty' | 'rate_limited' | 'error'
  finishReason?: string | null
  blockReason?: string | null
  toolsCalled: string[]
  geminiCalls: number
  queueWaitMs: number
  attempts: number
  modelTier: string
  cacheHit: boolean
  durationMs: number
  replyChars: number
  errorMessage?: string | null
}

export async function logAgentRun(data: AgentRunLogData): Promise<void> {
  try {
    const db = getDb()
    const now = new Date().toISOString()
    const row: NewAgentRunLog = {
      id: genId(),
      runId: data.runId,
      agentId: data.agentId,
      channel: data.channel,
      priority: data.priority,
      status: data.status,
      finishReason: data.finishReason || null,
      blockReason: data.blockReason || null,
      toolsCalled: JSON.stringify(data.toolsCalled),
      geminiCalls: data.geminiCalls,
      queueWaitMs: data.queueWaitMs,
      attempts: data.attempts,
      modelTier: data.modelTier,
      cacheHit: data.cacheHit,
      durationMs: data.durationMs,
      replyChars: data.replyChars,
      errorMessage: data.errorMessage || null,
      createdAt: now,
    }
    await db.insert(agentRunLogs).values(row)
  } catch (err) {
    // Non-fatal: log to console but don't fail the agent run
    console.error('[agent-run-log] Failed to write log:', err)
  }
}

export function createRunLogger(runId: string, agentId: string, channel: string, priority: string) {
  const startTime = Date.now()
  return {
    log: (msg: string, meta?: Record<string, unknown>) => {
      const elapsed = Date.now() - startTime
      console.log(`[AgentRun:${runId.slice(0, 8)}] ${msg}`, { agentId, channel, elapsed, ...meta })
    },
    complete: async (data: Omit<AgentRunLogData, 'runId' | 'agentId' | 'channel' | 'priority' | 'durationMs'>) => {
      const durationMs = Date.now() - startTime
      await logAgentRun({
        runId,
        agentId,
        channel: channel as AgentRunLogData['channel'],
        priority: priority as AgentRunLogData['priority'],
        durationMs,
        ...data,
      })
    },
  }
}
