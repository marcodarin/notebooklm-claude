import { logger } from './logger.js'

export interface RetryOptions {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  retryableCheck?: (err: unknown) => boolean
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
}

export async function withRetry<T> (
  fn: () => Promise<T>,
  label: string,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options }

  let lastError: unknown
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      if (opts.retryableCheck && !opts.retryableCheck(err)) {
        throw err
      }

      const nonRetryableCodes = ['AUTH_EXPIRED', 'NOTEBOOK_NOT_FOUND', 'NOTEBOOK_ACCESS_DENIED']
      if (err && typeof err === 'object' && 'code' in err) {
        if (nonRetryableCodes.includes((err as { code: string }).code)) {
          throw err
        }
      }

      if (attempt < opts.maxRetries) {
        const delay = Math.min(
          opts.baseDelayMs * Math.pow(2, attempt) + Math.random() * 500,
          opts.maxDelayMs
        )
        logger.warn({
          label,
          attempt: attempt + 1,
          maxRetries: opts.maxRetries,
          delayMs: Math.round(delay),
          err: err instanceof Error ? err.message : String(err),
        }, 'Retrying after error')
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}

export class CircuitBreaker {
  private failures = 0
  private lastFailureTime = 0
  private state: 'closed' | 'open' | 'half-open' = 'closed'

  constructor (
    private readonly threshold: number = 5,
    private readonly resetTimeMs: number = 60_000,
    private readonly label: string = 'circuit-breaker'
  ) {}

  async execute<T> (fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime
      if (elapsed > this.resetTimeMs) {
        this.state = 'half-open'
        logger.info({ label: this.label }, 'Circuit breaker half-open, allowing test request')
      } else {
        throw new Error(`Circuit breaker open for ${this.label}. Try again in ${Math.ceil((this.resetTimeMs - elapsed) / 1000)}s.`)
      }
    }

    try {
      const result = await fn()
      if (this.state === 'half-open') {
        this.state = 'closed'
        this.failures = 0
        logger.info({ label: this.label }, 'Circuit breaker closed after successful request')
      }
      return result
    } catch (err) {
      this.failures++
      this.lastFailureTime = Date.now()

      if (this.failures >= this.threshold) {
        this.state = 'open'
        logger.error({ label: this.label, failures: this.failures }, 'Circuit breaker opened')
      }

      throw err
    }
  }

  getState (): { state: string; failures: number } {
    return { state: this.state, failures: this.failures }
  }

  reset (): void {
    this.state = 'closed'
    this.failures = 0
  }
}
