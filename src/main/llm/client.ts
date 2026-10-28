import OpenAI from 'openai'

export interface LlmConfig {
  apiKey: string
  baseUrl: string
  model: string
  /** Leave DeepSeek's own thinking mode on; by default it is switched off (see completeJson). */
  keepThinking?: boolean
}

export interface LlmUsage {
  promptTokens: number
  completionTokens: number
  cacheHitTokens: number
  /** The part of completionTokens spent on reasoning; only thinking models report any. */
  reasoningTokens?: number
}

export interface LlmReply {
  text: string
  finishReason: string
  usage: LlmUsage
  durationMs: number
  model: string
}

export type LlmErrorCode =
  'auth' | 'bad_request' | 'rate_limit' | 'server' | 'timeout' | 'network' | 'parse' | 'aborted'

const MESSAGES: Record<LlmErrorCode, string> = {
  auth: 'API key 无效或已过期，请在设置里检查。',
  bad_request: '请求被拒绝（模型名或参数可能不对），请在设置里检查。',
  rate_limit: '请求太频繁或余额不足，稍后会自动重试。',
  server: '模型服务暂时不可用，稍后重试。',
  timeout: '请求超时，检查网络后重试。',
  network: '无法连接到模型服务，检查网络或 Base URL。',
  parse: '模型返回的内容无法解析。',
  aborted: '请求已取消。'
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly code: LlmErrorCode,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'LlmError'
  }

  /** Errors that retrying cannot fix: the queue stops instead of burning through words. */
  get fatal(): boolean {
    return this.code === 'auth' || this.code === 'bad_request'
  }

  static from(err: unknown): LlmError {
    if (err instanceof LlmError) return err
    const make = (code: LlmErrorCode): LlmError => new LlmError(MESSAGES[code], code, err)
    if (err instanceof OpenAI.APIUserAbortError) return make('aborted')
    if (err instanceof OpenAI.APIConnectionTimeoutError) return make('timeout')
    if (err instanceof OpenAI.APIConnectionError) return make('network')
    if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) {
      return make('auth')
    }
    if (err instanceof OpenAI.RateLimitError) return make('rate_limit')
    if (err instanceof OpenAI.BadRequestError || err instanceof OpenAI.NotFoundError) {
      return make('bad_request')
    }
    if (err instanceof OpenAI.APIError) {
      // DeepSeek answers 402 when the balance runs out.
      if (err.status === 402) return new LlmError('DeepSeek 账户余额不足。', 'rate_limit', err)
      return make('server')
    }
    if (err instanceof Error && err.name === 'AbortError') return make('aborted')
    return new LlmError(err instanceof Error ? err.message : String(err), 'network', err)
  }
}

// DeepSeek's switch for thinking mode, which the SDK's types do not know.
type ChatParams = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & {
  thinking?: { type: 'enabled' | 'disabled' }
}

function isDeepSeek(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.endsWith('deepseek.com')
  } catch {
    return false
  }
}

// DeepSeek speaks the OpenAI chat-completions protocol, so the official OpenAI SDK is the
// client; the base URL and model come from settings, which also lets any other compatible
// service stand in.
export class LlmClient {
  private readonly api: OpenAI

  constructor(readonly config: LlmConfig) {
    this.api = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: 120_000,
      maxRetries: 3
    })
  }

  get model(): string {
    return this.config.model
  }

  async completeJson(
    system: string,
    user: string,
    maxTokens: number,
    signal?: AbortSignal
  ): Promise<LlmReply> {
    const started = Date.now()
    const params: ChatParams = {
      model: this.config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      response_format: { type: 'json_object' },
      max_tokens: maxTokens,
      temperature: 0.3
    }
    // DeepSeek's current models think before they answer unless told not to, and the reasoning
    // is billed as output. Filling in a JSON template needs none of it, and thinking mode would
    // also ignore the temperature above.
    if (!this.config.keepThinking && isDeepSeek(this.config.baseUrl)) {
      params.thinking = { type: 'disabled' }
    }
    try {
      const res = await this.api.chat.completions.create(params, { signal })
      const choice = res.choices[0]
      const usage = res.usage as
        (OpenAI.CompletionUsage & { prompt_cache_hit_tokens?: number }) | undefined
      return {
        text: choice?.message?.content ?? '',
        finishReason: choice?.finish_reason ?? 'unknown',
        usage: {
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
          cacheHitTokens: usage?.prompt_cache_hit_tokens ?? 0,
          reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0
        },
        durationMs: Date.now() - started,
        model: res.model || this.config.model
      }
    } catch (err) {
      throw LlmError.from(err)
    }
  }

  /** Checks the key and base URL without spending tokens. */
  async check(): Promise<{ ok: boolean; message: string }> {
    try {
      const models = await this.api.models.list()
      const ids = models.data.map((m) => m.id)
      if (ids.length > 0 && !ids.includes(this.config.model)) {
        return {
          ok: false,
          message: `连接成功，但没有模型「${this.config.model}」。可用：${ids.join('、')}`
        }
      }
      return { ok: true, message: `连接成功，模型「${this.config.model}」可用。` }
    } catch (err) {
      return { ok: false, message: LlmError.from(err).message }
    }
  }
}

function stripMarkdown(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
}

export function parseJsonReply(text: string): unknown {
  const body = stripMarkdown(text)
  if (!body) throw new LlmError('模型返回了空内容。', 'parse')
  try {
    return JSON.parse(body)
  } catch (err) {
    throw new LlmError(MESSAGES.parse, 'parse', err)
  }
}
