import { normKey } from '../../shared/text'
import type { TriageItem } from '../../shared/types'
import { cleanHeadword, isHeadwordLike } from '../import/normalize'
import { mapLimit } from '../util/async'
import { LlmError, parseJsonReply } from './client'
import type { LlmContext } from './enrich'
import { buildTriageSystemPrompt, buildTriageUserPrompt } from './prompts/triage'
import { rawTriageItemSchema, triageReplySchema } from './schemas'

// A chunk's reply has to fit in MAX_TOKENS, and it has run to about 100 tokens per word.
const CHUNK = 60
const MAX_TOKENS = 8192

function untouched(word: string): TriageItem {
  return { input: word, kind: 'ok', suggestion: word, keepSeparate: false, note: '' }
}

// One item per requested word, in order. A suggestion that is not a usable headword, or
// that only repeats the input, turns the item back into a plain "ok".
function align(words: string[], items: unknown[]): TriageItem[] {
  const byInput = new Map<string, TriageItem>()
  for (const raw of items) {
    const parsed = rawTriageItemSchema.safeParse(raw)
    if (!parsed.success) continue
    const it = parsed.data
    const suggestion = cleanHeadword(it.suggestion)
    const item: TriageItem = {
      input: it.input,
      kind: it.kind,
      suggestion: isHeadwordLike(suggestion) ? suggestion : it.input,
      keepSeparate: it.keep_separate,
      note: it.note.trim()
    }
    const changes = normKey(item.suggestion) !== normKey(item.input)
    if (!changes && ['inflection', 'misspelling', 'variant'].includes(item.kind)) {
      item.kind = 'ok'
    }
    byInput.set(normKey(it.input.trim()), item)
  }
  return words.map((word) => {
    const item = byInput.get(normKey(word))
    return item ? { ...item, input: word } : untouched(word)
  })
}

async function triageChunk(ctx: LlmContext, words: string[]): Promise<TriageItem[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const startedAt = Date.now()
    let reply
    try {
      reply = await ctx.client.completeJson(
        buildTriageSystemPrompt(),
        buildTriageUserPrompt(words),
        MAX_TOKENS,
        ctx.signal
      )
    } catch (err) {
      const e = LlmError.from(err)
      ctx.record({
        kind: 'triage',
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
      kind: 'triage' as const,
      model: reply.model,
      words: words.length,
      ...reply.usage,
      startedAt,
      durationMs: reply.durationMs
    }
    if (reply.finishReason === 'length' && words.length > 1) {
      ctx.record({ ...call, ok: false, error: 'output truncated' })
      const mid = Math.ceil(words.length / 2)
      return [
        ...(await triageChunk(ctx, words.slice(0, mid))),
        ...(await triageChunk(ctx, words.slice(mid)))
      ]
    }
    try {
      const { items } = triageReplySchema.parse(parseJsonReply(reply.text))
      ctx.record({ ...call, ok: true, error: null })
      return align(words, items)
    } catch {
      ctx.record({ ...call, ok: false, error: 'unparseable reply' })
    }
  }
  // Clean-up is a convenience: when the model cannot produce it, the words stay as they are.
  return words.map(untouched)
}

export async function triageWords(
  ctx: LlmContext,
  words: string[],
  onProgress?: (done: number, total: number) => void
): Promise<TriageItem[]> {
  const chunks: string[][] = []
  for (let i = 0; i < words.length; i += CHUNK) chunks.push(words.slice(i, i + CHUNK))
  let done = 0
  onProgress?.(0, chunks.length)
  const results = await mapLimit(chunks, 3, async (chunk) => {
    const items = await triageChunk(ctx, chunk)
    onProgress?.(++done, chunks.length)
    return items
  })
  return results.flat()
}
