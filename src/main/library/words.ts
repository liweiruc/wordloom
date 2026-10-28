import type { FSRS } from 'ts-fsrs'
import { splitCloze } from '../../shared/cloze'
import { cleanSynonyms } from '../../shared/synonyms'
import { englishTokens, normKey } from '../../shared/text'
import {
  MATURE_DAYS,
  type CardState,
  type Grade,
  type ListSummary,
  type Outcome,
  type Register,
  type ReviewLogView,
  type SensePatch,
  type SenseView,
  type WordDetail,
  type WordKind,
  type WordListPage,
  type WordPatch,
  type WordQuery,
  type WordStatus
} from '../../shared/types'
import type { DB } from '../db/types'
import { cleanHeadword, isHeadwordLike } from '../import/normalize'
import type { EntryDraft } from '../llm/validate'
import { toCardView, type CardRow } from '../srs/scheduler'

// ---------- generation bookkeeping ----------

export interface PendingWord {
  id: number
  headword: string
}

/** Takes up to `limit` pending words off the queue, marking them as being generated. */
export function claimPending(db: DB, limit: number): PendingWord[] {
  return db.transaction(() => {
    const rows = db
      .prepare("SELECT id, headword FROM words WHERE status = 'pending' ORDER BY id LIMIT ?")
      .all(limit) as PendingWord[]
    const mark = db.prepare("UPDATE words SET status = 'enriching' WHERE id = ?")
    for (const row of rows) mark.run(row.id)
    return rows
  })()
}

/** Words left half-generated when the app last closed go back in the queue. */
export function resetInterrupted(db: DB): number {
  return db.prepare("UPDATE words SET status = 'pending' WHERE status = 'enriching'").run().changes
}

export function returnToPending(db: DB, ids: number[]): void {
  const stmt = db.prepare(
    "UPDATE words SET status = 'pending' WHERE id = ? AND status = 'enriching'"
  )
  db.transaction(() => ids.forEach((id) => stmt.run(id)))()
}

export function markFailed(db: DB, id: number, error: string): void {
  db.prepare("UPDATE words SET status = 'failed', error = ? WHERE id = ?").run(error, id)
}

export function retryFailed(db: DB): number {
  return db
    .prepare("UPDATE words SET status = 'pending', error = NULL WHERE status = 'failed'")
    .run().changes
}

export function countByStatus(db: DB): Record<WordStatus, number> {
  const counts: Record<WordStatus, number> = { pending: 0, enriching: 0, ready: 0, failed: 0 }
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM words GROUP BY status').all() as {
    status: WordStatus
    n: number
  }[]
  for (const row of rows) counts[row.status] = row.n
  return counts
}

function contentTokens(text: string): Set<string> {
  return new Set(englishTokens(text).filter((t) => t.length >= 3))
}

function similar(a: string, b: string): boolean {
  const ta = contentTokens(a)
  const tb = contentTokens(b)
  if (ta.size === 0 || tb.size === 0) return false
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / (ta.size + tb.size - shared) >= 0.5
}

export interface SaveMeta {
  model: string
  promptVersion: number
  maxSenses: number
  now: number
}

// Stores a generated entry and gives every new sense its card. On regeneration, senses that
// have been studied or edited by hand stay, with their cards and history; only untouched
// senses are replaced, and new ones that repeat a kept sense are skipped.
export function saveEnrichment(db: DB, wordId: number, draft: EntryDraft, meta: SaveMeta): void {
  db.transaction(() => {
    const word = db.prepare('SELECT norm FROM words WHERE id = ?').get(wordId) as
      { norm: string } | undefined
    if (!word) return

    const kept = db
      .prepare(
        `SELECT s.id, s.ord, s.def_en FROM senses s LEFT JOIN cards c ON c.sense_id = s.id
         WHERE s.word_id = ? AND (COALESCE(c.reps, 0) > 0 OR s.user_edited = 1) ORDER BY s.ord`
      )
      .all(wordId) as { id: number; ord: number; def_en: string }[]
    const keptIds = new Set(kept.map((k) => k.id))
    const existing = db.prepare('SELECT id FROM senses WHERE word_id = ?').all(wordId) as {
      id: number
    }[]
    const remove = db.prepare('DELETE FROM senses WHERE id = ?')
    for (const { id } of existing) if (!keptIds.has(id)) remove.run(id)

    const insertSense = db.prepare(
      'INSERT INTO senses (word_id, ord, pos, def_en, def_zh, synonyms, register) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    const insertExample = db.prepare(
      'INSERT INTO examples (sense_id, ord, en, zh, cloze) VALUES (?, 0, ?, ?, ?)'
    )
    const insertCard = db.prepare(
      'INSERT INTO cards (sense_id, word_id, due, new_rank, created_at) VALUES (?, ?, ?, ?, ?)'
    )

    let ord = kept.length > 0 ? Math.max(...kept.map((k) => k.ord)) + 1 : 0
    const room = Math.max(0, meta.maxSenses - kept.length)
    const fresh = draft.senses
      .filter((s) => !kept.some((k) => similar(k.def_en, s.defEn)))
      .slice(0, room)
    for (const sense of fresh) {
      const senseId = Number(
        insertSense.run(
          wordId,
          ord++,
          sense.pos,
          sense.defEn,
          sense.defZh,
          JSON.stringify(sense.synonyms),
          sense.register
        ).lastInsertRowid
      )
      insertExample.run(senseId, sense.exampleEn, sense.exampleZh, JSON.stringify(sense.cloze))
      insertCard.run(senseId, wordId, meta.now, Math.random(), meta.now)
    }

    const headword = normKey(draft.headword) === word.norm ? draft.headword : null
    db.prepare(
      `UPDATE words SET headword = COALESCE(?, headword), ipa_uk = ?, ipa_us = ?, variants = ?,
         status = 'ready', error = NULL, llm_model = ?, prompt_version = ?, enriched_at = ?
       WHERE id = ?`
    ).run(
      headword,
      draft.ipaUk,
      draft.ipaUs,
      JSON.stringify(draft.variants),
      meta.model,
      meta.promptVersion,
      meta.now,
      wordId
    )
  })()
}

// ---------- library list ----------

const SORTS: Record<NonNullable<WordQuery['sort']>, string> = {
  recent: 'w.id DESC',
  alpha: 'w.norm ASC',
  due: 'next_due ASC NULLS LAST, w.norm ASC'
}

export function listWords(db: DB, query: WordQuery): WordListPage {
  const where: string[] = []
  const params: unknown[] = []
  if (query.search?.trim()) {
    const like = `%${query.search
      .trim()
      .toLowerCase()
      .replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    where.push(
      `(w.norm LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM senses s WHERE s.word_id = w.id AND (s.def_zh LIKE ? ESCAPE '\\' OR lower(s.def_en) LIKE ? ESCAPE '\\')))`
    )
    params.push(like, like, like)
  }
  if (query.status && query.status !== 'all') {
    where.push('w.status = ?')
    params.push(query.status)
  }
  if (query.listId != null) {
    where.push('EXISTS (SELECT 1 FROM list_words lw WHERE lw.word_id = w.id AND lw.list_id = ?)')
    params.push(query.listId)
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM words w ${clause}`).get(...params) as { n: number }
  ).n

  const rows = db
    .prepare(
      `SELECT w.id, w.headword, w.ipa_us, w.status, w.error, w.created_at,
        (SELECT COUNT(*) FROM senses s WHERE s.word_id = w.id) AS sense_count,
        (SELECT COUNT(*) FROM cards c WHERE c.word_id = w.id AND c.reps > 0) AS reviewed_cards,
        (SELECT COUNT(*) FROM cards c WHERE c.word_id = w.id AND c.state = 2 AND c.stability >= ${MATURE_DAYS}) AS mature_cards,
        (SELECT MIN(c.due) FROM cards c WHERE c.word_id = w.id AND c.suspended = 0 AND c.state != 0) AS next_due,
        (SELECT s.def_en FROM senses s WHERE s.word_id = w.id ORDER BY s.ord LIMIT 1) AS first_def
       FROM words w ${clause}
       ORDER BY ${SORTS[query.sort ?? 'recent']}
       LIMIT ? OFFSET ?`
    )
    .all(...params, query.limit ?? 100, query.offset ?? 0) as {
    id: number
    headword: string
    ipa_us: string
    status: WordStatus
    error: string | null
    created_at: number
    sense_count: number
    reviewed_cards: number
    mature_cards: number
    next_due: number | null
    first_def: string | null
  }[]

  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      headword: r.headword,
      ipaUs: r.ipa_us,
      status: r.status,
      error: r.error,
      senseCount: r.sense_count,
      reviewedCards: r.reviewed_cards,
      matureCards: r.mature_cards,
      nextDue: r.next_due,
      firstDef: r.first_def,
      createdAt: r.created_at
    }))
  }
}

// ---------- word detail ----------

interface WordRow {
  id: number
  headword: string
  norm: string
  kind: WordKind
  ipa_uk: string
  ipa_us: string
  variants: string
  status: WordStatus
  error: string | null
  llm_model: string | null
  enriched_at: number | null
  created_at: number
  note: string
}

interface SenseRow {
  id: number
  ord: number
  pos: string
  def_en: string
  def_zh: string
  synonyms: string
  register: Register
  user_edited: number
}

interface ExampleRow {
  id: number
  sense_id: number
  en: string
  zh: string
  cloze: string
}

export function parseCloze(json: string): string[] {
  try {
    const parts = JSON.parse(json) as unknown
    return Array.isArray(parts) ? parts.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

export function parseVariants(json: string): string[] {
  return parseCloze(json)
}

export function parseSynonyms(json: string): string[] {
  return parseCloze(json)
}

export function getWordDetail(db: DB, scheduler: FSRS, id: number, now = Date.now()): WordDetail {
  const word = db.prepare('SELECT * FROM words WHERE id = ?').get(id) as WordRow | undefined
  if (!word) throw new Error('这个词已经不存在了。')

  const lists = db
    .prepare(
      'SELECT l.id, l.name FROM lists l JOIN list_words lw ON lw.list_id = l.id WHERE lw.word_id = ? ORDER BY l.created_at'
    )
    .all(id) as { id: number; name: string }[]
  const senses = db
    .prepare('SELECT * FROM senses WHERE word_id = ? ORDER BY ord')
    .all(id) as SenseRow[]
  const examples = db
    .prepare(
      'SELECT e.* FROM examples e JOIN senses s ON s.id = e.sense_id WHERE s.word_id = ? ORDER BY e.ord'
    )
    .all(id) as ExampleRow[]
  const cards = db.prepare('SELECT * FROM cards WHERE word_id = ?').all(id) as CardRow[]
  const logs = db
    .prepare(
      `SELECT l.*, c.sense_id FROM review_logs l JOIN cards c ON c.id = l.card_id
       WHERE l.word_id = ? ORDER BY l.reviewed_at DESC LIMIT 200`
    )
    .all(id) as {
    id: number
    card_id: number
    sense_id: number
    reviewed_at: number
    rating: Grade
    outcome: Outcome
    answer: string
    hints_used: number
    duration_ms: number
    state_before: CardState
    scheduled_days: number
    stability: number
  }[]

  const senseViews: SenseView[] = senses.map((s) => {
    const example = examples.find((e) => e.sense_id === s.id)
    const card = cards.find((c) => c.sense_id === s.id)
    return {
      id: s.id,
      ord: s.ord,
      pos: s.pos,
      defEn: s.def_en,
      defZh: s.def_zh,
      synonyms: parseSynonyms(s.synonyms),
      register: s.register,
      userEdited: s.user_edited === 1,
      example: example
        ? { id: example.id, en: example.en, zh: example.zh, cloze: parseCloze(example.cloze) }
        : null,
      card: card ? toCardView(scheduler, card, now) : null
    }
  })

  const logViews: ReviewLogView[] = logs.map((l) => ({
    id: l.id,
    cardId: l.card_id,
    senseId: l.sense_id,
    reviewedAt: l.reviewed_at,
    rating: l.rating,
    outcome: l.outcome,
    answer: l.answer,
    hintsUsed: l.hints_used,
    durationMs: l.duration_ms,
    stateBefore: l.state_before,
    scheduledDays: l.scheduled_days,
    stability: l.stability
  }))

  return {
    id: word.id,
    headword: word.headword,
    norm: word.norm,
    kind: word.kind,
    ipaUk: word.ipa_uk,
    ipaUs: word.ipa_us,
    variants: parseVariants(word.variants),
    status: word.status,
    error: word.error,
    llmModel: word.llm_model,
    enrichedAt: word.enriched_at,
    createdAt: word.created_at,
    note: word.note,
    lists,
    senses: senseViews,
    logs: logViews
  }
}

// ---------- edits ----------

export function updateWord(db: DB, id: number, patch: WordPatch): void {
  const word = db.prepare('SELECT headword, norm FROM words WHERE id = ?').get(id) as
    { headword: string; norm: string } | undefined
  if (!word) throw new Error('这个词已经不存在了。')
  let headword = word.headword
  if (patch.headword !== undefined) {
    const cleaned = cleanHeadword(patch.headword)
    if (!isHeadwordLike(cleaned)) throw new Error('词头只能包含英文字母、空格、连字符和撇号。')
    if (normKey(cleaned) !== word.norm) {
      const clash = db
        .prepare('SELECT id FROM words WHERE norm = ? AND id != ?')
        .get(normKey(cleaned), id)
      if (clash) throw new Error(`词库里已经有「${cleaned}」了。`)
    }
    headword = cleaned
  }
  db.prepare(
    `UPDATE words SET headword = ?, norm = ?, ipa_uk = COALESCE(?, ipa_uk), ipa_us = COALESCE(?, ipa_us),
       note = COALESCE(?, note) WHERE id = ?`
  ).run(
    headword,
    normKey(headword),
    patch.ipaUk ?? null,
    patch.ipaUs ?? null,
    patch.note ?? null,
    id
  )
}

/** Returns the word the sense belongs to. */
export function updateSense(db: DB, senseId: number, patch: SensePatch): number {
  const sense = db.prepare('SELECT word_id FROM senses WHERE id = ?').get(senseId) as
    { word_id: number } | undefined
  if (!sense) throw new Error('这个义项已经不存在了。')
  const example = db
    .prepare('SELECT * FROM examples WHERE sense_id = ? ORDER BY ord LIMIT 1')
    .get(senseId) as ExampleRow | undefined

  db.transaction(() => {
    db.prepare(
      `UPDATE senses SET pos = COALESCE(?, pos), def_en = COALESCE(?, def_en), def_zh = COALESCE(?, def_zh),
         synonyms = COALESCE(?, synonyms), register = COALESCE(?, register), user_edited = 1 WHERE id = ?`
    ).run(
      patch.pos?.trim() || null,
      patch.defEn?.trim() || null,
      patch.defZh?.trim() || null,
      // An empty list is a real edit: it clears the synonyms.
      patch.synonyms ? JSON.stringify(cleanSynonyms(patch.synonyms)) : null,
      patch.register ?? null,
      senseId
    )
    if (
      patch.exampleEn !== undefined ||
      patch.exampleZh !== undefined ||
      patch.cloze !== undefined
    ) {
      const en = (patch.exampleEn ?? example?.en ?? '').trim()
      const zh = (patch.exampleZh ?? example?.zh ?? '').trim()
      const cloze = (patch.cloze ?? (example ? parseCloze(example.cloze) : []))
        .map((p) => p.trim())
        .filter(Boolean)
      // A card blanks the cloze inside its sentence, so the two have to agree.
      if (!splitCloze(en, cloze)) {
        throw new Error('挖空的词在例句里找不到：需要按整词、按顺序出现在例句中。')
      }
      if (example) {
        db.prepare('UPDATE examples SET en = ?, zh = ?, cloze = ? WHERE id = ?').run(
          en,
          zh,
          JSON.stringify(cloze),
          example.id
        )
      } else {
        db.prepare(
          'INSERT INTO examples (sense_id, ord, en, zh, cloze) VALUES (?, 0, ?, ?, ?)'
        ).run(senseId, en, zh, JSON.stringify(cloze))
      }
    }
  })()
  return sense.word_id
}

export function deleteSense(db: DB, senseId: number): number {
  const sense = db.prepare('SELECT word_id FROM senses WHERE id = ?').get(senseId) as
    { word_id: number } | undefined
  if (!sense) throw new Error('这个义项已经不存在了。')
  db.prepare('DELETE FROM senses WHERE id = ?').run(senseId)
  return sense.word_id
}

export function queueRegenerate(db: DB, id: number): void {
  const changed = db
    .prepare(
      "UPDATE words SET status = 'pending', error = NULL WHERE id = ? AND status != 'enriching'"
    )
    .run(id).changes
  if (changed === 0) throw new Error('这个词正在生成中，请稍候。')
}

export function removeWord(db: DB, id: number): void {
  db.prepare('DELETE FROM words WHERE id = ?').run(id)
}

/** Returns the word the card belongs to. */
export function setSuspended(db: DB, cardId: number, suspended: boolean): number {
  const card = db.prepare('SELECT word_id FROM cards WHERE id = ?').get(cardId) as
    { word_id: number } | undefined
  if (!card) throw new Error('这张卡已经不存在了。')
  db.prepare('UPDATE cards SET suspended = ? WHERE id = ?').run(suspended ? 1 : 0, cardId)
  return card.word_id
}

// ---------- lists ----------

export function listSummaries(db: DB): ListSummary[] {
  const rows = db
    .prepare(
      `SELECT l.id, l.name, l.source_file, l.created_at,
         COUNT(w.id) AS words,
         COALESCE(SUM(w.status = 'ready'), 0) AS ready,
         COALESCE(SUM(w.status = 'failed'), 0) AS failed,
         (SELECT COUNT(*) FROM cards c JOIN list_words x ON x.word_id = c.word_id WHERE x.list_id = l.id) AS cards,
         (SELECT COUNT(*) FROM cards c JOIN list_words x ON x.word_id = c.word_id WHERE x.list_id = l.id AND c.reps > 0) AS studied,
         (SELECT COUNT(*) FROM cards c JOIN list_words x ON x.word_id = c.word_id
            WHERE x.list_id = l.id AND c.state = 2 AND c.stability >= ${MATURE_DAYS}) AS mature
       FROM lists l
       LEFT JOIN list_words lw ON lw.list_id = l.id
       LEFT JOIN words w ON w.id = lw.word_id
       GROUP BY l.id
       ORDER BY l.created_at DESC`
    )
    .all() as {
    id: number
    name: string
    source_file: string | null
    created_at: number
    words: number
    ready: number
    failed: number
    cards: number
    studied: number
    mature: number
  }[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sourceFile: r.source_file,
    createdAt: r.created_at,
    words: r.words,
    ready: r.ready,
    failed: r.failed,
    cards: r.cards,
    studiedCards: r.studied,
    matureCards: r.mature
  }))
}

export function renameList(db: DB, id: number, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('词表名不能为空。')
  db.prepare('UPDATE lists SET name = ? WHERE id = ?').run(trimmed, id)
}

/** Deletes the list only; its words stay in the library. */
export function removeList(db: DB, id: number): void {
  db.prepare('DELETE FROM lists WHERE id = ?').run(id)
}
