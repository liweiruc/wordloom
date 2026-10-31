import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { DEFAULT_SETTINGS } from '../src/main/db/settings'
import { commitImport, IMPORTED_MODEL } from '../src/main/import/commit'
import { countByStatus } from '../src/main/library/words'
import { LlmClient, type LlmConfig } from '../src/main/llm/client'
import { enrichWords } from '../src/main/llm/enrich'
import { EnrichQueue } from '../src/main/llm/enrichQueue'
import { buildEnrichSystemPrompt } from '../src/main/llm/prompts/enrich'
import { triageWords } from '../src/main/llm/triage'
import { checkEntry, leakedForm, normalizePos } from '../src/main/llm/validate'
import type { EnrichStatus } from '../src/shared/types'
import { entry, fakeClient, reply, sense } from './helpers'

const noRecord = (): void => {}

describe('checkEntry', () => {
  it('accepts a well-formed entry and tidies it', () => {
    const check = checkEntry(
      entry('wiggle', [sense({ pos: 'verb', register: 'Neutral' })], {
        ipa_uk: 'ˈwɪɡ.əl',
        ipa_us: ''
      }),
      'wiggle',
      4
    )
    expect(check.problems).toEqual([])
    expect(check.entry).toMatchObject({
      headword: 'wiggle',
      ipaUk: '/ˈwɪɡ.əl/',
      ipaUs: '/ˈwɪɡ.əl/',
      senses: [{ pos: 'v.', register: 'neutral', synonyms: ['squirm', 'twist'], cloze: ['wiggle'] }]
    })
  })

  it('keeps the synonyms that are real clues and quietly drops the rest', () => {
    const check = checkEntry(
      entry('wiggle', [
        sense({
          // A repeat, a relative of the headword, Chinese, two in one string, and one too many.
          synonyms: ['squirm', 'Squirm', 'wiggly', '扭动', 'writhe, twitch', 'jiggle']
        })
      ]),
      'wiggle',
      4
    )
    expect(check.problems).toEqual([])
    expect(check.entry?.senses[0].synonyms).toEqual(['squirm', 'writhe', 'twitch'])
  })

  it('reads synonyms given as one string, and drops the ones that share a phrasal verb word', () => {
    const phrasal = {
      pos: 'phr. v.',
      def_en: 'to stop trying',
      example_en: 'Never give up on your dreams.',
      cloze: ['give up']
    }
    const check = checkEntry(
      entry('give up', [sense({ ...phrasal, synonyms: 'give in, quit, surrender' })]),
      'give up',
      4
    )
    expect(check.problems).toEqual([])
    expect(check.entry?.senses[0].synonyms).toEqual(['quit', 'surrender'])
  })

  it('never lets a missing or malformed synonyms value cost the sense', () => {
    for (const synonyms of [undefined, null, 42, { a: 1 }, [1, null], '', []]) {
      const check = checkEntry(entry('wiggle', [sense({ synonyms })]), 'wiggle', 4)
      expect(check.problems).toEqual([])
      expect(check.entry?.senses[0].synonyms).toEqual([])
    }
  })

  it('rejects a definition that gives the word away', () => {
    const check = checkEntry(
      entry('resilient', [
        sense({
          def_en: 'showing resilience after a difficult time',
          example_en: 'Kids are resilient and bounce back fast.',
          cloze: ['resilient']
        })
      ]),
      'resilient',
      4
    )
    expect(check.entry).toBeNull()
    expect(check.problems[0]).toMatch(/gives the answer away by using "resilience"/)
  })

  it('rejects a cloze that is not in the sentence, or not the headword', () => {
    const missing = checkEntry(entry('wiggle', [sense({ cloze: ['wiggled'] })]), 'wiggle', 4)
    expect(missing.problems[0]).toMatch(/does not appear in example_en/)
    const other = checkEntry(entry('wiggle', [sense({ cloze: ['jacket'] })]), 'wiggle', 4)
    expect(other.problems[0]).toMatch(/is not the headword/)
  })

  it('rejects a sentence that shows the word a second time', () => {
    const check = checkEntry(
      entry('wiggle', [
        sense({ example_en: 'Wiggle your toes, then wiggle your fingers.', cloze: ['Wiggle'] })
      ]),
      'wiggle',
      4
    )
    expect(check.problems[0]).toMatch(/outside the blank/)
  })

  it('keeps the senses that pass and drops the rest', () => {
    const check = checkEntry(
      entry('wiggle', [sense(), sense({ def_zh: 'no chinese here' }), sense()]),
      'wiggle',
      2
    )
    expect(check.entry?.senses).toHaveLength(1)
    expect(check.problems).toEqual(['sense 2: def_zh must be Chinese'])
  })

  it('accepts split phrasal verbs and lets the model fix capitalisation only', () => {
    const check = checkEntry(
      entry(
        'rip off',
        [
          sense({
            pos: 'phrasal verb',
            def_en: 'to cheat someone by charging too much',
            example_en: 'That taxi driver ripped us off.',
            cloze: ['ripped', 'off']
          })
        ],
        { headword: 'Rip Off' }
      ),
      'rip off',
      4
    )
    expect(check.problems).toEqual([])
    expect(check.entry?.headword).toBe('Rip Off')
    expect(check.entry?.senses[0].pos).toBe('phr. v.')
    const swapped = checkEntry(entry('rip off', [], { headword: 'rip-off' }), 'rip off', 4)
    expect(swapped.problems).toContain('no senses were given')
  })
})

describe('validation helpers', () => {
  it('spots forms and relatives but not unrelated words', () => {
    expect(leakedForm('when someone is wiggling', 'wiggle')).toBe('wiggling')
    expect(leakedForm('to cause anger on purpose', 'provoke')).toBeNull()
    expect(leakedForm('a provocation meant to annoy', 'provoke')).toBe('provocation')
    expect(leakedForm('to stop doing something', 'give up')).toBeNull()
    expect(leakedForm('to give something away for free', 'give up')).toBe('give')
  })

  it('normalizes part-of-speech labels', () => {
    expect(normalizePos('Noun')).toBe('n.')
    expect(normalizePos('vt.')).toBe('v.')
    expect(normalizePos('phr. v.')).toBe('phr. v.')
    expect(normalizePos('idiom')).toBe('idiom')
  })
})

describe('enrichWords', () => {
  it('repairs a bad entry with its problem list', async () => {
    const { client, calls } = fakeClient([
      reply([
        entry('wiggle', [sense()]),
        entry('tile', [sense({ cloze: ['wiggle'], def_en: 'a flat square piece' })])
      ]),
      reply([
        entry('tile', [
          sense({
            pos: 'n.',
            def_en: 'a flat square piece used to cover floors or walls',
            def_zh: '瓷砖',
            example_en: 'We picked white tiles for the new bathroom.',
            example_zh: '我们给新浴室选了白色瓷砖。',
            cloze: ['tiles']
          })
        ])
      ])
    ])
    const outcomes = await enrichWords({ client, maxSenses: 4, record: noRecord }, [
      'wiggle',
      'tile'
    ])
    expect(outcomes.map((o) => o.entry?.senses.length ?? 0)).toEqual([1, 1])
    expect(calls).toHaveLength(2)
    expect(calls[1].user).toContain('is not the headword "tile"')
  })

  it('splits a batch whose output was cut off', async () => {
    const { client, calls } = fakeClient([
      { text: '{"entries": [', finishReason: 'length' },
      reply([entry('wiggle', [sense()])]),
      reply([
        entry('wiggly', [
          sense({
            pos: 'adj.',
            def_en: 'moving in small quick turns',
            example_en: 'He drew a wiggly line.',
            cloze: ['wiggly']
          })
        ])
      ])
    ])
    const outcomes = await enrichWords({ client, maxSenses: 4, record: noRecord }, [
      'wiggle',
      'wiggly'
    ])
    expect(outcomes.every((o) => o.entry)).toBe(true)
    expect(calls.map((c) => JSON.parse(c.user.split('\n')[0]).words)).toEqual([
      ['wiggle', 'wiggly'],
      ['wiggle'],
      ['wiggly']
    ])
  })

  it('fails a word whose repairs never pass', async () => {
    const bad = reply([entry('tile', [sense()])])
    const { client } = fakeClient([bad, bad, bad])
    const [outcome] = await enrichWords({ client, maxSenses: 4, record: noRecord }, ['tile'])
    expect(outcome.entry).toBeNull()
    expect(outcome.problems.join(' ')).toMatch(/not the headword/)
  })
})

describe('EnrichQueue', () => {
  it('generates every pending word and creates one card per sense', async () => {
    const db = openDatabase(':memory:')
    commitImport(db, { listName: 'l', sourceFile: null, items: [{ headword: 'wiggle' }] })
    const { client } = fakeClient([
      reply([
        entry('wiggle', [
          sense(),
          sense({
            pos: 'n.',
            def_en: 'a small quick movement',
            example_en: 'She gave a little wiggle of her hips.',
            cloze: ['wiggle']
          })
        ])
      ])
    ])
    const statuses: EnrichStatus[] = []
    let finish: () => void = () => {}
    const finished = new Promise<void>((resolve) => (finish = resolve))
    const queue = new EnrichQueue({
      db,
      getClient: () => client,
      getSettings: () => DEFAULT_SETTINGS,
      onStatus: (s) => {
        statuses.push(s)
        if (!s.running && s.pending === 0 && s.enriching === 0) finish()
      }
    })
    queue.kick()
    await finished
    expect(countByStatus(db)).toMatchObject({ ready: 1, pending: 0, failed: 0 })
    const cards = db.prepare('SELECT state FROM cards').all()
    expect(cards).toHaveLength(2)
    const calls = db.prepare('SELECT kind, ok, cache_hit_tokens FROM llm_calls').all()
    expect(calls).toEqual([{ kind: 'enrich', ok: 1, cache_hit_tokens: 80 }])
    expect(statuses.at(-1)?.session.done).toBe(1)
  })

  it('pauses on a bad key and keeps the words pending', async () => {
    const db = openDatabase(':memory:')
    commitImport(db, { listName: 'l', sourceFile: null, items: [{ headword: 'wiggle' }] })
    const { LlmError } = await import('../src/main/llm/client')
    const client = {
      model: 'fake-model',
      completeJson: async () => {
        throw new LlmError('API key 无效', 'auth')
      }
    } as never
    let finish: () => void = () => {}
    const finished = new Promise<void>((resolve) => (finish = resolve))
    const queue = new EnrichQueue({
      db,
      getClient: () => client,
      getSettings: () => DEFAULT_SETTINGS,
      onStatus: (s) => {
        if (s.paused && !s.running) finish()
      }
    })
    queue.kick()
    await finished
    expect(queue.status()).toMatchObject({ paused: true, pending: 1, lastError: 'API key 无效' })
  })

  it('keeps the entry an import saved while the model was still writing', async () => {
    const db = openDatabase(':memory:')
    commitImport(db, { listName: 'l', sourceFile: null, items: [{ headword: 'wiggle' }] })
    const imported = checkEntry(entry('wiggle', [sense()]), 'wiggle', 4).entry
    if (!imported) throw new Error('the wiggle entry should pass')
    const { client } = fakeClient([
      () => {
        // The queue has claimed the word for this request; an entries file brings it meanwhile.
        commitImport(db, {
          listName: 'e',
          sourceFile: 'e.json',
          items: [{ headword: 'wiggle', entry: imported }]
        })
        return reply([
          entry('wiggle', [
            sense(),
            sense({
              pos: 'n.',
              def_en: 'a small quick movement',
              example_en: 'She gave a little wiggle of her hips.',
              cloze: ['wiggle']
            })
          ])
        ])
      }
    ])
    const statuses: EnrichStatus[] = []
    let finish: () => void = () => {}
    const finished = new Promise<void>((resolve) => (finish = resolve))
    const queue = new EnrichQueue({
      db,
      getClient: () => client,
      getSettings: () => DEFAULT_SETTINGS,
      onStatus: (s) => {
        statuses.push(s)
        if (!s.running && s.pending === 0 && s.enriching === 0) finish()
      }
    })
    queue.kick()
    await finished
    expect(db.prepare('SELECT status, llm_model FROM words').get()).toEqual({
      status: 'ready',
      llm_model: IMPORTED_MODEL
    })
    expect(db.prepare('SELECT COUNT(*) AS n FROM cards').get()).toEqual({ n: 1 })
    expect(statuses.at(-1)?.session.done).toBe(0)
  })
})

describe('triageWords', () => {
  it('aligns items to the input and ignores no-op suggestions', async () => {
    const { client } = fakeClient([
      JSON.stringify({
        items: [
          {
            input: 'thresholds',
            kind: 'inflection',
            suggestion: 'threshold',
            keep_separate: false,
            note: 'threshold 的复数'
          },
          {
            input: 'harrass',
            kind: 'misspelling',
            suggestion: 'harass',
            keep_separate: false,
            note: 'harass 的错误拼写'
          },
          {
            input: 'wiggle',
            kind: 'inflection',
            suggestion: 'wiggle',
            keep_separate: false,
            note: ''
          }
        ]
      })
    ])
    const items = await triageWords({ client, record: noRecord }, [
      'thresholds',
      'harrass',
      'wiggle',
      'Jerusalem'
    ])
    expect(items.map((i) => [i.input, i.kind, i.suggestion])).toEqual([
      ['thresholds', 'inflection', 'threshold'],
      ['harrass', 'misspelling', 'harass'],
      ['wiggle', 'ok', 'wiggle'],
      ['Jerusalem', 'ok', 'Jerusalem']
    ])
  })
})

describe('the enrich prompt', () => {
  it('asks for synonyms, and its own example obeys every rule it states', () => {
    const prompt = buildEnrichSystemPrompt(4)
    expect(prompt).toContain('- "synonyms":')
    const example = JSON.parse(prompt.split('Example output:\n')[1]) as {
      entries: { input: string; senses: { synonyms: string[] }[] }[]
    }
    for (const e of example.entries) {
      const check = checkEntry(e, e.input, 4)
      expect(check.problems).toEqual([])
      // Nothing the example shows is dropped as a bad synonym.
      expect(check.entry?.senses.map((s) => s.synonyms)).toEqual(e.senses.map((s) => s.synonyms))
    }
  })
})

describe('token savings', () => {
  it('shows the model a one-line example', () => {
    const example = buildEnrichSystemPrompt(4).split('Example output:\n')[1]
    expect(example).not.toContain('\n')
    expect(JSON.parse(example).entries).toHaveLength(2)
  })

  it('turns DeepSeek thinking off unless asked to keep it', async () => {
    async function requestBody(config: Partial<LlmConfig>): Promise<Record<string, unknown>> {
      const client = new LlmClient({
        apiKey: 'key',
        baseUrl: 'https://api.deepseek.com',
        model: 'm',
        ...config
      })
      let body: Record<string, unknown> = {}
      const create = async (params: Record<string, unknown>): Promise<unknown> => {
        body = params
        return { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], model: 'm' }
      }
      Object.assign(client, { api: { chat: { completions: { create } } } })
      await client.completeJson('system', 'user', 100)
      return body
    }
    expect((await requestBody({})).thinking).toEqual({ type: 'disabled' })
    expect((await requestBody({ keepThinking: true })).thinking).toBeUndefined()
    expect((await requestBody({ baseUrl: 'https://api.example.com/v1' })).thinking).toBeUndefined()
  })
})
