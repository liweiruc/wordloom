import { describe, expect, it } from 'vitest'
import { openDatabase, type DB } from '../src/main/db/connection'
import { migrate, SCHEMA_VERSION } from '../src/main/db/migrations'
import { DEFAULT_SETTINGS } from '../src/main/db/settings'
import { commitImport } from '../src/main/import/commit'
import { countByStatus, saveEnrichment } from '../src/main/library/words'
import type { LlmClient } from '../src/main/llm/client'
import { buildEnrichSystemPrompt } from '../src/main/llm/prompts/enrich'
import { recordLlmCall } from '../src/main/llm/usage'
import {
  addToDefaultList,
  lookupHistory,
  lookupWord,
  regenerateLookup,
  removeLookup,
  type LookupDeps
} from '../src/main/lookup/lookup'
import { buildDailyQueue } from '../src/main/srs/queue'
import { makeScheduler } from '../src/main/srs/scheduler'
import type { EntryDraft } from '../src/shared/types'
import { entry, fakeClient, reply, sense } from './helpers'

const NOW = new Date(2026, 9, 27, 10, 0, 0).getTime()
const scheduler = makeScheduler({ ...DEFAULT_SETTINGS.study })

function deps(db: DB, client: LlmClient): LookupDeps {
  return {
    db,
    scheduler,
    settings: DEFAULT_SETTINGS,
    requireClient: () => client,
    record: (call) => recordLlmCall(db, call)
  }
}

/** A client that fails the test if it is asked anything at all. */
const silent = (): LlmClient => fakeClient([]).client

/** The clean-up's verdict on one word. */
function triaged(input: string, kind = 'ok', suggestion = input, note = ''): string {
  return JSON.stringify({ items: [{ input, kind, suggestion, keep_separate: false, note }] })
}

function draft(headword: string, defEn: string): EntryDraft {
  return {
    headword,
    ipaUk: '/x/',
    ipaUs: '/x/',
    variants: [],
    senses: [
      {
        pos: 'n.',
        defEn,
        defZh: '释义',
        synonyms: [],
        register: 'neutral',
        exampleEn: `I saw the ${headword} today.`,
        exampleZh: '例句。',
        cloze: [headword]
      }
    ]
  }
}

/** Imports a word into a list and gives it an entry, as the generation queue would. */
function libraryWord(db: DB, headword: string, list = '示例', at = NOW): number {
  commitImport(db, { listName: list, sourceFile: null, items: [{ headword }] }, at)
  const { id } = db.prepare('SELECT id FROM words WHERE norm = ?').get(headword) as { id: number }
  saveEnrichment(db, id, draft(headword, 'a thing used for testing'), {
    model: 'm',
    promptVersion: 2,
    maxSenses: 4,
    now: at
  })
  return id
}

function listsOf(db: DB, wordId: number): string[] {
  return (
    db
      .prepare(
        'SELECT l.name FROM lists l JOIN list_words lw ON lw.list_id = l.id WHERE lw.word_id = ? ORDER BY l.id'
      )
      .all(wordId) as { name: string }[]
  ).map((r) => r.name)
}

const llmCalls = (db: DB): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM llm_calls').get() as { n: number }).n

describe('lookupWord', () => {
  it('generates a new word with the library prompt, keeps it, and never asks twice', async () => {
    const db = openDatabase(':memory:')
    const { client, calls } = fakeClient([triaged('wiggle'), reply([entry('wiggle', [sense()])])])

    const first = await lookupWord(deps(db, client), 'wiggle', false, NOW)
    expect(first).toMatchObject({
      headword: 'wiggle',
      ipaUk: '/ˈwɪɡ.əl/',
      source: 'generated',
      wordId: null,
      status: null,
      inDefaultList: false,
      correction: null
    })
    expect(first.senses).toHaveLength(1)
    expect(first.senses[0]).toMatchObject({ pos: 'v.', synonyms: ['squirm', 'twist'] })
    // The very prompt the generation queue uses, so the entry reads like every other one.
    expect(calls[1].system).toBe(buildEnrichSystemPrompt(DEFAULT_SETTINGS.llm.maxSenses))

    const again = await lookupWord(deps(db, client), 'Wiggle', false, NOW + 60_000)
    expect(again).toMatchObject({ source: 'saved', headword: 'wiggle' })
    expect(again.senses).toEqual(first.senses)
    expect(calls).toHaveLength(2)

    expect(lookupHistory(db)).toEqual([
      {
        id: expect.any(Number),
        headword: 'wiggle',
        gloss: '扭动；摆动',
        lookedUpAt: NOW + 60_000,
        wordId: null,
        inDefaultList: false
      }
    ])
  })

  it('shows a library word as the library has it, without the model', async () => {
    const db = openDatabase(':memory:')
    const id = libraryWord(db, 'wiggle')

    const result = await lookupWord(deps(db, silent()), 'wiggle', false, NOW)
    expect(result).toMatchObject({
      source: 'library',
      wordId: id,
      status: 'ready',
      inDefaultList: false,
      senses: [{ defEn: 'a thing used for testing', exampleEn: 'I saw the wiggle today.' }]
    })
    expect(lookupHistory(db)).toMatchObject([{ headword: 'wiggle', gloss: '释义', wordId: id }])
  })

  it('looks an inflection up as its headword, or exactly as typed when asked', async () => {
    const db = openDatabase(':memory:')
    const { client, calls } = fakeClient([
      triaged('wiggled', 'inflection', 'wiggle', 'wiggle 的过去式'),
      reply([entry('wiggle', [sense()])]),
      reply([
        entry('wiggled', [sense({ example_en: 'The puppy wiggled with joy.', cloze: ['wiggled'] })])
      ])
    ])

    const cleaned = await lookupWord(deps(db, client), 'wiggled', false, NOW)
    expect(cleaned).toMatchObject({
      headword: 'wiggle',
      source: 'generated',
      correction: { input: 'wiggled', kind: 'inflection', note: 'wiggle 的过去式' }
    })
    expect(JSON.parse(calls[1].user)).toEqual({ words: ['wiggle'] })

    const typed = await lookupWord(deps(db, client), 'wiggled', true, NOW)
    expect(typed).toMatchObject({ headword: 'wiggled', source: 'generated', correction: null })
    // No clean-up the second time: straight to the entry.
    expect(calls).toHaveLength(3)
    expect(JSON.parse(calls[2].user)).toEqual({ words: ['wiggled'] })
  })

  it('finds the headword the clean-up suggests in the library', async () => {
    const db = openDatabase(':memory:')
    const id = libraryWord(db, 'threshold')
    const { client } = fakeClient([
      triaged('thresholds', 'inflection', 'threshold', 'threshold 的复数')
    ])

    const result = await lookupWord(deps(db, client), 'thresholds', false, NOW)
    expect(result).toMatchObject({
      source: 'library',
      wordId: id,
      correction: { input: 'thresholds', note: 'threshold 的复数' }
    })
  })

  it('skips the clean-up when it is switched off', async () => {
    const db = openDatabase(':memory:')
    const { client, calls } = fakeClient([
      reply([
        entry('wiggled', [sense({ example_en: 'The puppy wiggled with joy.', cloze: ['wiggled'] })])
      ])
    ])
    const off = { ...DEFAULT_SETTINGS, llm: { ...DEFAULT_SETTINGS.llm, smartCleanup: false } }

    const result = await lookupWord({ ...deps(db, client), settings: off }, 'wiggled', false, NOW)
    expect(result).toMatchObject({ headword: 'wiggled', correction: null })
    expect(calls).toHaveLength(1)
  })

  it('turns down input that is not an English word, and reports entries that never pass', async () => {
    const db = openDatabase(':memory:')
    await expect(lookupWord(deps(db, silent()), '皱纹', false, NOW)).rejects.toThrow('英文单词')

    const broken = sense({ def_en: 'when you wiggle a lot' })
    const { client } = fakeClient([
      triaged('wiggle'),
      reply([entry('wiggle', [broken])]),
      reply([entry('wiggle', [broken])]),
      reply([entry('wiggle', [broken])])
    ])
    await expect(lookupWord(deps(db, client), 'wiggle', false, NOW)).rejects.toThrow(
      '没能生成「wiggle」的词条'
    )
    expect(lookupHistory(db)).toEqual([])
  })
})

describe('regenerateLookup', () => {
  it('replaces the saved entry, and leaves library words to the library', async () => {
    const db = openDatabase(':memory:')
    const { client } = fakeClient([
      triaged('wiggle'),
      reply([entry('wiggle', [sense()])]),
      reply([entry('wiggle', [sense({ def_en: 'to twist and turn with quick small movements' })])])
    ])
    await lookupWord(deps(db, client), 'wiggle', false, NOW)

    const fresh = await regenerateLookup(deps(db, client), 'wiggle', NOW)
    expect(fresh).toMatchObject({ source: 'generated' })
    expect(fresh.senses[0].defEn).toBe('to twist and turn with quick small movements')
    const saved = await lookupWord(deps(db, client), 'wiggle', false, NOW)
    expect(saved.senses[0].defEn).toBe('to twist and turn with quick small movements')

    libraryWord(db, 'wiggle')
    await expect(regenerateLookup(deps(db, client), 'wiggle', NOW)).rejects.toThrow('已在词库')
  })
})

describe('addToDefaultList', () => {
  it('adds a looked-up word with its saved entry, ready at once and first in line', async () => {
    const db = openDatabase(':memory:')
    const apple = libraryWord(db, 'apple', '示例', NOW - 60_000)
    const { client } = fakeClient([triaged('wiggle'), reply([entry('wiggle', [sense()])])])
    const looked = await lookupWord(deps(db, client), 'wiggle', false, NOW)
    const callsBefore = llmCalls(db)

    const added = addToDefaultList(deps(db, silent()), 'wiggle', NOW)
    expect(added).toMatchObject({
      headword: 'wiggle',
      source: 'library',
      status: 'ready',
      inDefaultList: true
    })
    expect(added.senses).toEqual(looked.senses)
    expect(llmCalls(db)).toBe(callsBefore)
    expect(countByStatus(db)).toMatchObject({ pending: 0, enriching: 0, ready: 2 })
    expect(listsOf(db, added.wordId!)).toEqual(['生词本'])
    expect(
      db.prepare('SELECT llm_model, prompt_version FROM words WHERE id = ?').get(added.wordId)
    ).toEqual({ llm_model: 'fake-model', prompt_version: 2 })

    // Its new card is introduced before the word imported earlier.
    const fresh = buildDailyQueue(db, scheduler, DEFAULT_SETTINGS.study, NOW).entries
    expect(fresh.filter((e) => e.kind === 'new').map((e) => e.wordId)).toEqual([
      added.wordId,
      apple
    ])
    const byWord = buildDailyQueue(
      db,
      scheduler,
      { ...DEFAULT_SETTINGS.study, newOrder: 'by-word' },
      NOW
    ).entries
    expect(byWord[0].wordId).toBe(added.wordId)

    // Adding again changes nothing.
    const ranks = (): unknown[] =>
      db.prepare('SELECT new_rank FROM cards WHERE word_id = ?').all(added.wordId)
    const before = ranks()
    expect(addToDefaultList(deps(db, silent()), 'wiggle', NOW).inDefaultList).toBe(true)
    expect(ranks()).toEqual(before)
    expect(lookupHistory(db)).toMatchObject([{ headword: 'wiggle', inDefaultList: true }])
  })

  it("puts a looked-up word's later senses ahead of imported words' main ones", async () => {
    const db = openDatabase(':memory:')
    const apple = libraryWord(db, 'apple', '示例', NOW - 60_000)
    const { client } = fakeClient([
      triaged('wiggle'),
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
    await lookupWord(deps(db, client), 'wiggle', false, NOW)
    const { wordId } = addToDefaultList(deps(db, silent()), 'wiggle', NOW)
    // Its main sense was learned days ago, so today only the second one is new.
    db.prepare(
      `UPDATE cards SET state = 2, reps = 1, stability = 10, last_review = ?, due = ?
       WHERE sense_id = (SELECT id FROM senses WHERE word_id = ? AND ord = 0)`
    ).run(NOW - 3 * 86_400_000, NOW + 7 * 86_400_000, wordId)

    const fresh = buildDailyQueue(db, scheduler, DEFAULT_SETTINGS.study, NOW).entries
    expect(fresh.map((e) => [e.kind, e.wordId])).toEqual([
      ['new', wordId],
      ['new', apple]
    ])
  })

  it('only links a word that is already in the library', () => {
    const db = openDatabase(':memory:')
    const id = libraryWord(db, 'wiggle')
    const senses = (): unknown[] => db.prepare('SELECT id FROM senses WHERE word_id = ?').all(id)
    const before = senses()

    const added = addToDefaultList(deps(db, silent()), 'wiggle', NOW)
    expect(added).toMatchObject({ wordId: id, inDefaultList: true })
    expect(senses()).toEqual(before)
    expect(listsOf(db, id)).toEqual(['示例', '生词本'])
  })

  it('needs the word to have been looked up first', () => {
    const db = openDatabase(':memory:')
    expect(() => addToDefaultList(deps(db, silent()), 'serendipity', NOW)).toThrow('请先查')
    expect(db.prepare('SELECT COUNT(*) AS n FROM lists').get()).toEqual({ n: 0 })
  })
})

describe('lookup history', () => {
  it('lists the latest lookup first and forgets one on request', async () => {
    const db = openDatabase(':memory:')
    libraryWord(db, 'apple')
    libraryWord(db, 'wiggle')
    await lookupWord(deps(db, silent()), 'apple', false, NOW)
    await lookupWord(deps(db, silent()), 'wiggle', false, NOW + 1)
    expect(lookupHistory(db).map((h) => h.headword)).toEqual(['wiggle', 'apple'])

    await lookupWord(deps(db, silent()), 'apple', false, NOW + 2)
    const history = lookupHistory(db)
    expect(history.map((h) => h.headword)).toEqual(['apple', 'wiggle'])

    removeLookup(db, history[0].id)
    expect(lookupHistory(db).map((h) => h.headword)).toEqual(['wiggle'])
  })
})

describe('migration 3', () => {
  // A database as version 2 left it: no lookups yet, and pasted words in a list of their own.
  function version2(lists: Record<string, string[]>): DB {
    const db = openDatabase(':memory:')
    db.exec('DROP TABLE lookups')
    db.pragma('user_version = 2')
    for (const [name, words] of Object.entries(lists)) {
      commitImport(db, {
        listName: name,
        sourceFile: null,
        items: words.map((headword) => ({ headword }))
      })
    }
    return db
  }

  function lists(db: DB): { id: number; name: string; words: string[] }[] {
    const rows = db.prepare('SELECT id, name FROM lists ORDER BY id').all() as {
      id: number
      name: string
    }[]
    return rows.map((l) => ({
      ...l,
      words: (
        db
          .prepare(
            'SELECT w.headword FROM list_words lw JOIN words w ON w.id = lw.word_id WHERE lw.list_id = ? ORDER BY lw.position'
          )
          .all(l.id) as { headword: string }[]
      ).map((w) => w.headword)
    }))
  }

  it('renames 粘贴的文本 to 生词本 when there is none yet', () => {
    const db = version2({ 粘贴的文本: ['apple', 'banana'], 示例: ['cherry'] })
    const [pasted] = lists(db)

    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(lists(db)).toEqual([
      { id: pasted.id, name: '生词本', words: ['apple', 'banana'] },
      { id: expect.any(Number), name: '示例', words: ['cherry'] }
    ])
    expect(lookupHistory(db)).toEqual([])
  })

  it('merges 粘贴的文本 into an existing 生词本', () => {
    const db = version2({ 生词本: ['banana', 'cherry'], 粘贴的文本: ['apple', 'banana'] })
    const [mine] = lists(db)

    migrate(db)

    expect(lists(db)).toEqual([
      { id: mine.id, name: '生词本', words: ['banana', 'cherry', 'apple'] }
    ])
  })

  it('leaves a database without 粘贴的文本 alone', () => {
    const db = version2({ 示例: ['apple'] })
    migrate(db)
    expect(lists(db)).toMatchObject([{ name: '示例', words: ['apple'] }])
  })
})
