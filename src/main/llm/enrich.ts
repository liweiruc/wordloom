import { normKey } from '../../shared/text'
import { LlmError, parseJsonReply, type LlmClient, type LlmReply } from './client'
import {
  buildEnrichSystemPrompt,
  buildEnrichUserPrompt,
  buildRepairUserPrompt
} from './prompts/enrich'
import { enrichReplySchema } from './schemas'
import { checkEntry, type EntryCheck, type EntryDraft } from './validate'

export interface LlmCallRecord {
  kind: 'triage' | 'enrich' | 'repair'
  model: string
  words: number
  promptTokens: number
  completionTokens: number
  cacheHitTokens: number
  /** Not stored; the smoke script reports it. */
  reasoningTokens?: number
  startedAt: number
  durationMs: number
  ok: boolean
  error: string | null
}

export interface LlmContext {
  client: LlmClient
  signal?: AbortSignal
  record(call: LlmCallRecord): void
}

export interface EnrichContext extends LlmContext {
  maxSenses: number
}

/**
 * The result for one headword. With `entry` it is saved; without, it failed for good,
 * unless `retryLater` says the request itself broke (network, quota) and the word should
 * simply go back in the queue.
 */
export interface EnrichOutcome {
  input: string
  entry: EntryDraft | null
  problems: string[]
  retryLater?: LlmError
}

// Room for eight full entries; a batch that still overflows is split in half.
const MAX_TOKENS = 8192
const REPAIR_ATTEMPTS = 2

type Reply = unknown[] | 'truncated'

async function request(
  ctx: EnrichContext,
  kind: 'enrich' | 'repair',
  words: string[],
  user: string
): Promise<Reply> {
  const startedAt = Date.now()
  let reply: LlmReply
  try {
    reply = await ctx.client.completeJson(
      buildEnrichSystemPrompt(ctx.maxSenses),
      user,
      MAX_TOKENS,
      ctx.signal
    )
  } catch (err) {
    const e = LlmError.from(err)
    ctx.record({
      kind,
      model: ctx.client.model,
      words: words.length,
      promptTokens: 0,
      completionTokens: 0,
      cacheHitTokens: 0,
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: false,
      error: e.message
    })
    throw e
  }
  const call = {
    kind,
    model: reply.model,
    words: words.length,
    ...reply.usage,
    startedAt,
    durationMs: reply.durationMs
  }
  if (reply.finishReason === 'length') {
    ctx.record({ ...call, ok: false, error: 'output truncated' })
    return 'truncated'
  }
  try {
    const { entries } = enrichReplySchema.parse(parseJsonReply(reply.text))
    ctx.record({ ...call, ok: true, error: null })
    return entries
  } catch (err) {
    ctx.record({ ...call, ok: false, error: 'unparseable reply' })
    throw err instanceof LlmError
      ? err
      : new LlmError('模型返回的 JSON 不是 {"entries": [...]}', 'parse', err)
  }
}

// Entries are matched to the requested words by "input". When the model rewrote the inputs
// but returned exactly one entry per word, position is the next best thing.
function pickEntry(entries: unknown[], word: string, index: number, total: number): unknown {
  const key = normKey(word.trim())
  const byInput = entries.find((e) => {
    const input = (e as { input?: unknown } | null)?.input
    return typeof input === 'string' && normKey(input.trim()) === key
  })
  if (byInput !== undefined) return byInput
  return entries.length === total ? entries[index] : undefined
}

function score(check: EntryCheck): number {
  return (check.entry?.senses.length ?? 0) * 10 - check.problems.length
}

async function settle(ctx: EnrichContext, word: string, raw: unknown): Promise<EnrichOutcome> {
  let check: EntryCheck =
    raw === undefined
      ? { entry: null, problems: ['no entry was returned for this headword'] }
      : checkEntry(raw, word, ctx.maxSenses)

  // Anything wrong goes back to the model for this word alone, with the list of problems.
  for (let attempt = 0; attempt < REPAIR_ATTEMPTS && check.problems.length > 0; attempt++) {
    let fixed: Reply
    try {
      fixed = await request(ctx, 'repair', [word], buildRepairUserPrompt(word, check.problems))
    } catch (err) {
      const e = LlmError.from(err)
      if (e.code === 'parse') continue
      // The request broke rather than the entry: keep what passed, or try again later.
      if (check.entry) break
      return { input: word, entry: null, problems: check.problems, retryLater: e }
    }
    if (fixed === 'truncated' || fixed.length === 0) continue
    const next = checkEntry(pickEntry(fixed, word, 0, 1), word, ctx.maxSenses)
    if (score(next) >= score(check)) check = next
  }
  // Senses that never passed are dropped; the word fails only if none passed at all.
  return { input: word, entry: check.entry, problems: check.problems }
}

export async function enrichWords(ctx: EnrichContext, words: string[]): Promise<EnrichOutcome[]> {
  let reply: Reply
  try {
    reply = await request(ctx, 'enrich', words, buildEnrichUserPrompt(words))
  } catch (err) {
    const e = LlmError.from(err)
    if (e.code !== 'parse') throw e
    // An unreadable batch is handled like a cut-off one: smaller batches, then repairs.
    reply = 'truncated'
  }
  if (reply === 'truncated') {
    if (words.length > 1) {
      const mid = Math.ceil(words.length / 2)
      const first = await enrichWords(ctx, words.slice(0, mid))
      const second = await enrichWords(ctx, words.slice(mid))
      return [...first, ...second]
    }
    reply = []
  }
  const entries = reply
  return Promise.all(
    words.map((word, i) => settle(ctx, word, pickEntry(entries, word, i, words.length)))
  )
}
