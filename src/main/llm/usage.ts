import type { DB } from '../db/connection'
import type { LlmCallRecord } from './enrich'

export function recordLlmCall(db: DB, call: LlmCallRecord): void {
  db.prepare(
    `INSERT INTO llm_calls (kind, model, words, prompt_tokens, completion_tokens, cache_hit_tokens, started_at, duration_ms, ok, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    call.kind,
    call.model,
    call.words,
    call.promptTokens,
    call.completionTokens,
    call.cacheHitTokens,
    call.startedAt,
    call.durationMs,
    call.ok ? 1 : 0,
    call.error
  )
}
