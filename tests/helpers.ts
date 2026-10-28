import type { LlmClient, LlmReply } from '../src/main/llm/client'

export interface FakeCall {
  system: string
  user: string
}

/** Stands in for the DeepSeek client: each request gets the next scripted reply. */
type Scripted = string | Partial<LlmReply>

export function fakeClient(replies: (Scripted | ((call: FakeCall) => Scripted))[]): {
  client: LlmClient
  calls: FakeCall[]
} {
  const calls: FakeCall[] = []
  const client = {
    model: 'fake-model',
    async completeJson(system: string, user: string): Promise<LlmReply> {
      const call = { system, user }
      calls.push(call)
      const next = replies.shift()
      if (next === undefined) throw new Error(`unexpected LLM call #${calls.length}: ${user}`)
      const value = typeof next === 'function' ? next(call) : next
      const reply = typeof value === 'string' ? { text: value } : value
      return {
        text: '',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, cacheHitTokens: 80 },
        durationMs: 5,
        model: 'fake-model',
        ...reply
      }
    }
  } as unknown as LlmClient
  return { client, calls }
}

export function sense(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pos: 'v.',
    def_en: 'to move with small quick movements from side to side',
    def_zh: '扭动；摆动',
    synonyms: ['squirm', 'twist'],
    register: 'neutral',
    example_en: 'The baby giggled and tried to wiggle out of her jacket.',
    example_zh: '宝宝咯咯笑着，想扭动着从外套里钻出来。',
    cloze: ['wiggle'],
    ...overrides
  }
}

export function entry(
  input: string,
  senses: Record<string, unknown>[],
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    input,
    headword: input,
    ipa_uk: '/ˈwɪɡ.əl/',
    ipa_us: '/ˈwɪɡ.əl/',
    variants: [],
    senses,
    ...extra
  }
}

export const reply = (entries: unknown[]): string => JSON.stringify({ entries })
