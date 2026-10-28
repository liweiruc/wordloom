import type { FSRS } from 'ts-fsrs'
import { normKey } from '../../shared/text'
import { suggestedHeadword } from '../../shared/triage'
import {
  DEFAULT_LIST_NAME,
  type AppSettings,
  type EntryDraft,
  type LookupCorrection,
  type LookupHistoryItem,
  type LookupResult
} from '../../shared/types'
import type { DB } from '../db/types'
import { commitImport } from '../import/commit'
import { cleanHeadword, isHeadwordLike } from '../import/normalize'
import { getWordDetail, saveEnrichment } from '../library/words'
import { LlmError, type LlmClient } from '../llm/client'
import { enrichWords, type LlmCallRecord } from '../llm/enrich'
import { ENRICH_PROMPT_VERSION } from '../llm/prompts/enrich'
import { triageWords } from '../llm/triage'

export interface LookupDeps {
  db: DB
  scheduler: FSRS
  settings: AppSettings
  /** Throws when no API key is set. */
  requireClient(): LlmClient
  record(call: LlmCallRecord): void
}

interface LookupRow {
  id: number
  headword: string
  norm: string
  entry: string | null
  llm_model: string | null
  prompt_version: number | null
  looked_up_at: number
}

function cleanQuery(query: string): string {
  const headword = cleanHeadword(query)
  if (!isHeadwordLike(headword)) throw new Error('请输入一个英文单词或短语。')
  return headword
}

function libraryId(db: DB, headword: string): number | null {
  const row = db.prepare('SELECT id FROM words WHERE norm = ?').get(normKey(headword)) as
    { id: number } | undefined
  return row?.id ?? null
}

// A library word is shown as the library has it, hand edits included.
function fromLibrary(deps: LookupDeps, wordId: number): LookupResult {
  const word = getWordDetail(deps.db, deps.scheduler, wordId)
  return {
    headword: word.headword,
    ipaUk: word.ipaUk,
    ipaUs: word.ipaUs,
    variants: word.variants,
    senses: word.senses.map((s) => ({
      pos: s.pos,
      defEn: s.defEn,
      defZh: s.defZh,
      synonyms: s.synonyms,
      register: s.register,
      exampleEn: s.example?.en ?? '',
      exampleZh: s.example?.zh ?? '',
      cloze: s.example?.cloze ?? []
    })),
    source: 'library',
    wordId: word.id,
    status: word.status,
    inDefaultList: word.lists.some((l) => l.name === DEFAULT_LIST_NAME),
    correction: null
  }
}

function fromEntry(entry: EntryDraft, source: 'saved' | 'generated'): LookupResult {
  return { ...entry, source, wordId: null, status: null, inDefaultList: false, correction: null }
}

// The word as the library has it, or as an earlier lookup saved it; null when the model has
// to be asked.
function findKnown(deps: LookupDeps, headword: string): LookupResult | null {
  const wordId = libraryId(deps.db, headword)
  if (wordId !== null) return fromLibrary(deps, wordId)
  const row = deps.db.prepare('SELECT entry FROM lookups WHERE norm = ?').get(normKey(headword)) as
    Pick<LookupRow, 'entry'> | undefined
  return row?.entry ? fromEntry(JSON.parse(row.entry) as EntryDraft, 'saved') : null
}

/** Puts the word at the top of the history. */
function touch(db: DB, headword: string, now: number): void {
  db.prepare(
    `INSERT INTO lookups (headword, norm, looked_up_at) VALUES (?, ?, ?)
     ON CONFLICT(norm) DO UPDATE SET headword = excluded.headword, looked_up_at = excluded.looked_up_at`
  ).run(headword, normKey(headword), now)
}

/** Keeps a generated entry for its word and puts the word at the top of the history. */
export function saveLookup(db: DB, entry: EntryDraft, model: string, now = Date.now()): void {
  db.prepare(
    `INSERT INTO lookups (headword, norm, entry, llm_model, prompt_version, looked_up_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(norm) DO UPDATE SET headword = excluded.headword, entry = excluded.entry,
       llm_model = excluded.llm_model, prompt_version = excluded.prompt_version,
       looked_up_at = excluded.looked_up_at`
  ).run(
    entry.headword,
    normKey(entry.headword),
    JSON.stringify(entry),
    model,
    ENRICH_PROMPT_VERSION,
    now
  )
}

// The generation queue retries a throttled request by itself; a lookup is only retried by
// hand, so its message must not promise otherwise.
async function ask<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (err) {
    const e = LlmError.from(err)
    if (e.code !== 'rate_limit') throw e
    throw new LlmError(e.message.replace('，稍后会自动重试', ''), e.code, e)
  }
}

// One entry, made exactly as the generation queue makes the library's: the same prompt,
// checks and repairs.
async function generate(
  deps: LookupDeps,
  client: LlmClient,
  headword: string,
  now: number
): Promise<LookupResult> {
  const outcome = await ask(async () => {
    const [result] = await enrichWords(
      { client, maxSenses: deps.settings.llm.maxSenses, record: deps.record },
      [headword]
    )
    if (result.retryLater) throw result.retryLater
    return result
  })
  if (!outcome.entry) {
    throw new Error(
      `没能生成「${headword}」的词条：${outcome.problems.join('; ') || '模型没有给出词条'}`
    )
  }
  saveLookup(deps.db, outcome.entry, client.model, now)
  return fromEntry(outcome.entry, 'generated')
}

/**
 * Looks a word up: in the library first, then among earlier lookups, and only then by asking
 * the model. Unless `asTyped`, the import's clean-up first turns an inflection or misspelling
 * into the headword to look up ("struck" into "strike").
 */
export async function lookupWord(
  deps: LookupDeps,
  query: string,
  asTyped = false,
  now = Date.now()
): Promise<LookupResult> {
  const typed = cleanQuery(query)
  const known = findKnown(deps, typed)
  if (known) {
    touch(deps.db, known.headword, now)
    return known
  }

  const client = deps.requireClient()
  let headword = typed
  let correction: LookupCorrection | null = null
  if (!asTyped && deps.settings.llm.smartCleanup) {
    const [item] = await ask(() => triageWords({ client, record: deps.record }, [typed]))
    headword = suggestedHeadword(typed, item)
    if (normKey(headword) !== normKey(typed)) {
      correction = { input: typed, kind: item.kind, note: item.note }
      const found = findKnown(deps, headword)
      if (found) {
        touch(deps.db, found.headword, now)
        return { ...found, correction }
      }
    }
  }
  return { ...(await generate(deps, client, headword, now)), correction }
}

/** Asks the model again for a word outside the library, replacing the entry its lookup saved. */
export async function regenerateLookup(
  deps: LookupDeps,
  headword: string,
  now = Date.now()
): Promise<LookupResult> {
  const target = cleanQuery(headword)
  if (libraryId(deps.db, target) !== null) {
    throw new Error('这个词已在词库中，请在单词详情里重新生成。')
  }
  return generate(deps, deps.requireClient(), target, now)
}

/**
 * Adds a looked-up word to 生词本. A library word is only linked. Any other goes in with the
 * entry its lookup saved, ready to study at once: the model is not asked again and the word
 * never waits in the generation queue. Either way its new cards go ahead of imported ones.
 */
export function addToDefaultList(
  deps: LookupDeps,
  headword: string,
  now = Date.now()
): LookupResult {
  const { db } = deps
  const target = cleanQuery(headword)
  const wordId = db.transaction(() => {
    const known = libraryId(db, target)
    const saved =
      known === null
        ? (db.prepare('SELECT * FROM lookups WHERE norm = ?').get(normKey(target)) as
            LookupRow | undefined)
        : undefined
    if (known === null && !saved?.entry) throw new Error('请先查这个词。')

    // A new word comes in pending and the saved entry fills it straight away, inside this
    // transaction, so the generation queue never sees it.
    commitImport(
      db,
      {
        listName: DEFAULT_LIST_NAME,
        sourceFile: null,
        items: [{ headword: saved?.headword ?? target }]
      },
      now
    )
    const id = libraryId(db, target)
    if (id === null) throw new Error('这个词不能加入词表。')
    if (saved?.entry) {
      saveEnrichment(db, id, JSON.parse(saved.entry) as EntryDraft, {
        model: saved.llm_model ?? '',
        promptVersion: saved.prompt_version ?? ENRICH_PROMPT_VERSION,
        maxSenses: deps.settings.llm.maxSenses,
        now
      })
    }
    // Imported words' new cards rank in [0, 1); a looked-up word's move to [-1, 0), ahead of
    // them (see buildDailyQueue).
    db.prepare(
      'UPDATE cards SET new_rank = new_rank - 1 WHERE word_id = ? AND state = 0 AND new_rank >= 0'
    ).run(id)
    return id
  })()
  return fromLibrary(deps, wordId)
}

export function lookupHistory(db: DB, limit = 100): LookupHistoryItem[] {
  const rows = db
    .prepare(
      `SELECT k.id, k.headword, k.entry, k.looked_up_at, w.id AS word_id,
         (SELECT s.def_zh FROM senses s WHERE s.word_id = w.id ORDER BY s.ord LIMIT 1) AS library_gloss,
         EXISTS (SELECT 1 FROM list_words lw JOIN lists l ON l.id = lw.list_id
                 WHERE lw.word_id = w.id AND l.name = ?) AS in_default
       FROM lookups k LEFT JOIN words w ON w.norm = k.norm
       ORDER BY k.looked_up_at DESC, k.id DESC
       LIMIT ?`
    )
    .all(DEFAULT_LIST_NAME, limit) as {
    id: number
    headword: string
    entry: string | null
    looked_up_at: number
    word_id: number | null
    library_gloss: string | null
    in_default: number
  }[]
  return rows.map((r) => ({
    id: r.id,
    headword: r.headword,
    gloss:
      r.library_gloss ??
      (r.entry ? ((JSON.parse(r.entry) as EntryDraft).senses[0]?.defZh ?? null) : null),
    lookedUpAt: r.looked_up_at,
    wordId: r.word_id,
    inDefaultList: r.in_default === 1
  }))
}

/** Forgets a lookup, and the entry it saved; the library is not touched. */
export function removeLookup(db: DB, id: number): void {
  db.prepare('DELETE FROM lookups WHERE id = ?').run(id)
}
