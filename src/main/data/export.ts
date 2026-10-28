import type { DB } from '../db/connection'
import { parseCloze, parseSynonyms, parseVariants } from '../library/words'

interface ExportRow {
  word_id: number
  headword: string
  ipa_uk: string
  ipa_us: string
  variants: string
  status: string
  note: string
  sense_id: number | null
  ord: number | null
  pos: string | null
  def_en: string | null
  def_zh: string | null
  synonyms: string | null
  register: string | null
  en: string | null
  zh: string | null
  cloze: string | null
  state: number | null
  due: number | null
  stability: number | null
  difficulty: number | null
  reps: number | null
  lapses: number | null
  suspended: number | null
}

function rows(db: DB): ExportRow[] {
  return db
    .prepare(
      `SELECT w.id AS word_id, w.headword, w.ipa_uk, w.ipa_us, w.variants, w.status, w.note,
         s.id AS sense_id, s.ord, s.pos, s.def_en, s.def_zh, s.synonyms, s.register,
         e.en, e.zh, e.cloze,
         c.state, c.due, c.stability, c.difficulty, c.reps, c.lapses, c.suspended
       FROM words w
       LEFT JOIN senses s ON s.word_id = w.id
       LEFT JOIN examples e ON e.id = (SELECT id FROM examples WHERE sense_id = s.id ORDER BY ord LIMIT 1)
       LEFT JOIN cards c ON c.sense_id = s.id
       ORDER BY w.norm, s.ord`
    )
    .all() as ExportRow[]
}

/** Everything a person would want to keep or move elsewhere, as one JSON document. */
export function exportJson(db: DB): string {
  const words = new Map<number, Record<string, unknown> & { senses: unknown[] }>()
  for (const r of rows(db)) {
    let word = words.get(r.word_id)
    if (!word) {
      word = {
        headword: r.headword,
        ipaUk: r.ipa_uk,
        ipaUs: r.ipa_us,
        variants: parseVariants(r.variants),
        status: r.status,
        note: r.note,
        senses: []
      }
      words.set(r.word_id, word)
    }
    if (r.sense_id !== null) {
      word.senses.push({
        pos: r.pos,
        defEn: r.def_en,
        defZh: r.def_zh,
        synonyms: parseSynonyms(r.synonyms ?? '[]'),
        register: r.register,
        example: r.en !== null ? { en: r.en, zh: r.zh, cloze: parseCloze(r.cloze ?? '[]') } : null,
        card:
          r.state !== null
            ? {
                state: r.state,
                due: r.due,
                stability: r.stability,
                difficulty: r.difficulty,
                reps: r.reps,
                lapses: r.lapses,
                suspended: r.suspended === 1
              }
            : null
      })
    }
  }
  const lists = db
    .prepare(
      `SELECT l.name, l.source_file, l.created_at, json_group_array(w.headword) AS words
       FROM lists l LEFT JOIN list_words lw ON lw.list_id = l.id LEFT JOIN words w ON w.id = lw.word_id
       GROUP BY l.id ORDER BY l.created_at`
    )
    .all() as { name: string; source_file: string | null; created_at: number; words: string }[]
  const reviews = db.prepare('SELECT COUNT(*) AS n FROM review_logs').get() as { n: number }
  return JSON.stringify(
    {
      app: 'wordloom',
      version: 1,
      exportedAt: new Date().toISOString(),
      reviewCount: reviews.n,
      lists: lists.map((l) => ({
        name: l.name,
        sourceFile: l.source_file,
        createdAt: l.created_at,
        words: (JSON.parse(l.words) as (string | null)[]).filter(Boolean)
      })),
      words: [...words.values()]
    },
    null,
    2
  )
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** One row per sense. The byte-order mark makes Excel read the Chinese as UTF-8. */
export function exportCsv(db: DB): string {
  const header = [
    'headword',
    'ipa_uk',
    'ipa_us',
    'pos',
    'def_en',
    'def_zh',
    'synonyms',
    'register',
    'example_en',
    'example_zh',
    'cloze',
    'state',
    'due',
    'stability',
    'reps',
    'lapses'
  ]
  const lines = [header.join(',')]
  for (const r of rows(db)) {
    if (r.sense_id === null) continue
    lines.push(
      [
        r.headword,
        r.ipa_uk,
        r.ipa_us,
        r.pos,
        r.def_en,
        r.def_zh,
        parseSynonyms(r.synonyms ?? '[]').join('; '),
        r.register,
        r.en,
        r.zh,
        parseCloze(r.cloze ?? '[]').join(' … '),
        r.state,
        r.due ? new Date(r.due).toISOString() : '',
        r.stability?.toFixed(2),
        r.reps,
        r.lapses
      ]
        .map(csvCell)
        .join(',')
    )
  }
  return '﻿' + lines.join('\r\n')
}
