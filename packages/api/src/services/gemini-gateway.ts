/**
 * Gemini Gateway — single point of entry for all LLM calls.
 * - Rate limiting (token bucket)
 * - Concurrency control (semaphore)
 * - Priority queue (interactive > event > batch)
 * - Exponential backoff with jitter
 * - Model tier fallback (flash-thinking → flash → flash-lite)
 * - Circuit breaker
 * - Daily budget tracking
 */
import { GoogleGenerativeAI, type GenerationConfig } from '@google/generative-ai'
import type { GenerateContentResult } from '@google/generative-ai'

export type Priority = 'interactive' | 'event' | 'batch'
export type ModelTier = 'flash-thinking' | 'flash' | 'flash-lite'

interface GatewayConfig {
  maxRpm: number
  maxConcurrency: number
  dailyBudget: number
  fallbackModels: string[]
}

interface QueuedRequest {
  priority: Priority
  fn: () => Promise<GenerateContentResult>
  resolve: (value: GenerateContentResult) => void
  reject: (error: Error) => void
  enqueuedAt: number
}

interface CircuitBreakerState {
  status: 'closed' | 'open' | 'half_open'
  failures: number
  lastFailureAt: number | null
  nextAttemptAt: number | null
}

interface RetryInfo {
  retryDelay?: { seconds?: number; nanos?: number }
}

const DEFAULT_CONFIG: GatewayConfig = {
  maxRpm: Number(process.env.GEMINI_MAX_RPM) || 8,
  maxConcurrency: Number(process.env.GEMINI_MAX_CONCURRENCY) || 2,
  dailyBudget: Number(process.env.GEMINI_DAILY_BUDGET) || 200,
  fallbackModels: (process.env.GEMINI_FALLBACK_MODELS || 'gemini-2.5-flash,gemini-2.5-flash-lite').split(','),
}

class GeminiGateway {
  private config: GatewayConfig
  private tokens: number
  private lastRefill: number
  private activeRequests: number
  private queue: QueuedRequest[]
  private breaker: CircuitBreakerState
  private dailyCallCount: number
  private dailyCountResetAt: number

  constructor(config: Partial<GatewayConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.tokens = this.config.maxRpm
    this.lastRefill = Date.now()
    this.activeRequests = 0
    this.queue = []
    this.breaker = { status: 'closed', failures: 0, lastFailureAt: null, nextAttemptAt: null }
    this.dailyCallCount = 0
    this.dailyCountResetAt = this.getTodayMidnightMs()
  }

  private getTodayMidnightMs(): number {
    const now = new Date()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
    return midnight.getTime()
  }

  private refillTokens(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    const tokensToAdd = (elapsed / 60000) * this.config.maxRpm
    this.tokens = Math.min(this.tokens + tokensToAdd, this.config.maxRpm)
    this.lastRefill = now
    if (now >= this.dailyCountResetAt) {
      this.dailyCallCount = 0
      this.dailyCountResetAt = this.getTodayMidnightMs()
    }
  }

  private canConsumeToken(priority: Priority): boolean {
    this.refillTokens()
    if (this.dailyCallCount >= this.config.dailyBudget && priority !== 'interactive') {
      return false
    }
    if (this.tokens < 1) return false
    if (this.activeRequests >= this.config.maxConcurrency) return false
    return true
  }

  private consumeToken(): void {
    this.tokens = Math.max(0, this.tokens - 1)
    this.dailyCallCount++
    this.activeRequests++
  }

  private releaseSlot(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1)
    this.processQueue()
  }

  private processQueue(): void {
    if (this.queue.length === 0) return
    // Sort by priority: interactive first, then event, then batch
    const priorityOrder: Record<Priority, number> = { interactive: 0, event: 1, batch: 2 }
    this.queue.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

    const req = this.queue[0]
    if (!req) return
    if (!this.canConsumeToken(req.priority)) return

    this.queue.shift()
    this.consumeToken()
    const startTime = Date.now()
    const queueWaitMs = startTime - req.enqueuedAt

    req
      .fn()
      .then((result) => {
        this.releaseSlot()
        this.recordSuccess()
        req.resolve(result)
      })
      .catch((err) => {
        this.releaseSlot()
        this.recordFailure(err)
        req.reject(err)
      })
  }

  private recordSuccess(): void {
    if (this.breaker.status === 'half_open') {
      this.breaker = { status: 'closed', failures: 0, lastFailureAt: null, nextAttemptAt: null }
    }
  }

  private recordFailure(err: Error): void {
    if (this.isRateLimitError(err) || this.is5xxError(err)) {
      this.breaker.failures++
      this.breaker.lastFailureAt = Date.now()
      if (this.breaker.failures >= 3 && this.breaker.status === 'closed') {
        this.breaker.status = 'open'
        this.breaker.nextAttemptAt = Date.now() + 60000 // 1 minute cooldown
      }
    }
  }

  private isRateLimitError(err: Error): boolean {
    const msg = err.message || ''
    return msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')
  }

  private is5xxError(err: Error): boolean {
    const msg = err.message || ''
    return /50\d/.test(msg)
  }

  private checkCircuitBreaker(priority: Priority): void {
    const now = Date.now()
    if (this.breaker.status === 'open') {
      if (priority === 'batch') {
        throw new Error('Circuit breaker open: batch requests are deferred')
      }
      if (this.breaker.nextAttemptAt && now >= this.breaker.nextAttemptAt) {
        this.breaker.status = 'half_open'
        this.breaker.failures = 0
      } else {
        // Allow interactive to try degraded path, but signal the breaker state
        const err = new Error('Circuit breaker open') as Error & { breakerOpen: boolean }
        err.breakerOpen = true
        throw err
      }
    }
  }

  async call(
    fn: () => Promise<GenerateContentResult>,
    options: { priority: Priority; retryBudget?: number },
  ): Promise<GenerateContentResult> {
    const { priority, retryBudget = priority === 'interactive' ? 2 : 1 } = options

    this.checkCircuitBreaker(priority)

    return new Promise<GenerateContentResult>((resolve, reject) => {
      const req: QueuedRequest = { priority, fn, resolve, reject, enqueuedAt: Date.now() }
      this.queue.push(req)
      this.processQueue()
    })
  }

  async callWithRetry(
    fn: () => Promise<GenerateContentResult>,
    options: { priority: Priority; modelTier?: ModelTier },
  ): Promise<{ result: GenerateContentResult; attempts: number; queueWaitMs: number; tier: ModelTier }> {
    const startTime = Date.now()
    let attempts = 0
    let lastError: Error | null = null
    const maxAttempts = options.priority === 'interactive' ? 3 : 2

    while (attempts < maxAttempts) {
      attempts++
      try {
        const result = await this.call(fn, { priority: options.priority, retryBudget: maxAttempts - attempts })
        const queueWaitMs = Date.now() - startTime
        return { result, attempts, queueWaitMs, tier: options.modelTier || 'flash' }
      } catch (err) {
        lastError = err as Error
        if (this.isRateLimitError(lastError)) {
          const delay = this.extractRetryDelay(lastError) || this.exponentialBackoff(attempts)
          await this.sleep(delay)
        } else {
          break
        }
      }
    }

    throw lastError || new Error('callWithRetry failed')
  }

  private extractRetryDelay(err: Error & { retryInfo?: RetryInfo }): number | null {
    if (!err.retryInfo?.retryDelay) return null
    const { seconds = 0, nanos = 0 } = err.retryInfo.retryDelay
    return seconds * 1000 + Math.floor(nanos / 1000000)
  }

  private exponentialBackoff(attempt: number): number {
    const base = 1000
    const maxDelay = 30000
    const delay = Math.min(base * Math.pow(2, attempt - 1), maxDelay)
    const jitter = Math.random() * 0.3 * delay
    return delay + jitter
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  getHealth(): {
    breakerState: 'closed' | 'open' | 'half_open'
    queueLength: number
    dailyBudgetRemaining: number
  } {
    this.refillTokens()
    return {
      breakerState: this.breaker.status,
      queueLength: this.queue.length,
      dailyBudgetRemaining: Math.max(0, this.config.dailyBudget - this.dailyCallCount),
    }
  }
}

// Singleton instance
const gateway = new GeminiGateway()

export function getGateway(): GeminiGateway {
  return gateway
}

/**
 * Get a Gemini model via the gateway. Use this instead of `new GoogleGenerativeAI(...)`.
 */
export function getGeminiModel(options: {
  apiKey?: string
  model?: string
  generationConfig?: GenerationConfig
  priority?: Priority
}): { model: string; generationConfig: GenerationConfig } {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is required')

  const modelId = options.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const generationConfig = options.generationConfig || getDefaultGenerationConfig()

  return { model: modelId, generationConfig }
}

function getDefaultGenerationConfig(): GenerationConfig {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  if (model.startsWith('gemini-3')) {
    const level = (process.env.GEMINI_THINKING_LEVEL || 'high').toLowerCase()
    return { thinkingConfig: { thinkingLevel: level } } as GenerationConfig
  }
  if (model.includes('2.5')) {
    const raw = process.env.GEMINI_THINKING_BUDGET?.trim()
    const budget = raw !== undefined && raw !== '' ? Number(raw) : -1
    return { thinkingConfig: { thinkingBudget: Number.isFinite(budget) ? budget : -1 } } as GenerationConfig
  }
  return {}
}
