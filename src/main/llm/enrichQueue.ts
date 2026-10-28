import type { AppSettings, EnrichStatus } from '../../shared/types'
import type { DB } from '../db/connection'
import {
  claimPending,
  countByStatus,
  markFailed,
  resetInterrupted,
  retryFailed,
  returnToPending,
  saveEnrichment
} from '../library/words'
import { sleep } from '../util/async'
import { LlmError, type LlmClient } from './client'
import { enrichWords, type LlmCallRecord } from './enrich'
import { ENRICH_PROMPT_VERSION } from './prompts/enrich'
import { recordLlmCall } from './usage'

export interface EnrichQueueDeps {
  db: DB
  /** Null while no API key is set. */
  getClient(): LlmClient | null
  getSettings(): AppSettings
  onStatus(status: EnrichStatus): void
}

// Generates entries for pending words in the background, a few batches at a time. Every
// finished word is saved (and gets its cards) at once, so studying can start while the
// rest of a list is still being generated. Request failures put the batch back; after
// repeated failures, or one that retrying cannot fix (a bad key), the queue pauses itself.
export class EnrichQueue {
  private running = false
  private paused = false
  private lastError: string | null = null
  private controller: AbortController | null = null
  private session = { done: 0, failed: 0, promptTokens: 0, completionTokens: 0, cacheHitTokens: 0 }

  constructor(private readonly deps: EnrichQueueDeps) {}

  status(): EnrichStatus {
    const counts = countByStatus(this.deps.db)
    return {
      running: this.running,
      paused: this.paused,
      hasApiKey: this.deps.getClient() !== null,
      ...counts,
      lastError: this.lastError,
      session: { ...this.session }
    }
  }

  /** Call once at startup: words cut off mid-generation go back in the queue. */
  recover(): void {
    resetInterrupted(this.deps.db)
  }

  kick(): void {
    if (this.running || this.paused) return
    void this.run()
  }

  pause(): void {
    this.paused = true
    this.controller?.abort()
    this.emit()
  }

  resume(): void {
    this.paused = false
    this.lastError = null
    this.emit()
    this.kick()
  }

  retryFailed(): void {
    retryFailed(this.deps.db)
    this.lastError = null
    this.paused = false
    this.emit()
    this.kick()
  }

  private emit(): void {
    this.deps.onStatus(this.status())
  }

  private record(call: LlmCallRecord): void {
    recordLlmCall(this.deps.db, call)
    this.session.promptTokens += call.promptTokens
    this.session.completionTokens += call.completionTokens
    this.session.cacheHitTokens += call.cacheHitTokens
  }

  private async run(): Promise<void> {
    const client = this.deps.getClient()
    if (!client) {
      this.lastError = '还没有设置 DeepSeek API key，请先到「设置」里填写。'
      this.emit()
      return
    }
    const { db } = this.deps
    const { batchSize, concurrency, maxSenses } = this.deps.getSettings().llm
    const controller = new AbortController()
    this.controller = controller
    this.running = true
    this.lastError = null
    this.emit()

    let failuresInARow = 0
    const worker = async (): Promise<void> => {
      while (!this.paused && !controller.signal.aborted) {
        const batch = claimPending(db, Math.max(1, batchSize))
        if (batch.length === 0) return
        try {
          const outcomes = await enrichWords(
            { client, maxSenses, signal: controller.signal, record: (c) => this.record(c) },
            batch.map((w) => w.headword)
          )
          const now = Date.now()
          const later: number[] = []
          let stopWith: LlmError | null = null
          for (const [i, outcome] of outcomes.entries()) {
            const word = batch[i]
            if (outcome.entry) {
              saveEnrichment(db, word.id, outcome.entry, {
                model: client.model,
                promptVersion: ENRICH_PROMPT_VERSION,
                maxSenses,
                now
              })
              this.session.done++
            } else if (outcome.retryLater) {
              later.push(word.id)
              if (outcome.retryLater.fatal) stopWith = outcome.retryLater
            } else {
              markFailed(db, word.id, outcome.problems.join('; ') || '生成失败')
              this.session.failed++
            }
          }
          returnToPending(db, later)
          failuresInARow = 0
          if (stopWith) this.stop(stopWith)
        } catch (err) {
          returnToPending(
            db,
            batch.map((w) => w.id)
          )
          const e = LlmError.from(err)
          if (e.code === 'aborted') return
          failuresInARow++
          this.lastError = e.message
          if (e.fatal || failuresInARow >= 3) {
            this.stop(e)
            return
          }
          await sleep(5_000 * failuresInARow, controller.signal)
        } finally {
          this.emit()
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
    } finally {
      this.running = false
      if (this.controller === controller) this.controller = null
      this.emit()
    }
    // Words imported while the last batches were finishing.
    if (!this.paused && countByStatus(db).pending > 0) this.kick()
  }

  private stop(err: LlmError): void {
    this.paused = true
    this.lastError = err.message
    this.controller?.abort()
  }
}
