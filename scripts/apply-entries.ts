// Puts entries that were written outside DeepSeek (by hand, or by any other model) into a copy
// of the database, the way the generation queue would:
//   npx tsx scripts/apply-entries.ts check <entries-dir> <database> [--partial]
//   npx tsx scripts/apply-entries.ts build <entries-dir> <database> <new-database> [model] [--partial]
// With --partial, a word that has no entry is left as it is instead of being reported.
// <entries-dir> holds *.json files, each a list of entries in the shape the generation prompt
// asks for ({ input, ipa_uk, ipa_us, variants?, senses: [...] }). A word that has a studied
// sense may also carry "kept_synonyms" for it, and "senses": [] when that sense is all it needs.
// `check` runs every entry through the validator the queue uses, and reports whatever is
// missing, wrong, or would be dropped. `build` saves every entry with saveEnrichment, so
// studied and hand-edited senses are kept, and writes <new-database>. <database> itself is
// never modified.
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDatabase, type DB } from '../src/main/db/connection'
import { loadSettings } from '../src/main/db/settings'
import { parseVariants, saveEnrichment } from '../src/main/library/words'
import { ENRICH_PROMPT_VERSION } from '../src/main/llm/prompts/enrich'
import { checkEntry, leakedForm, type EntryDraft } from '../src/main/llm/validate'
import { cleanSynonyms } from '../src/shared/synonyms'
import { normKey } from '../src/shared/text'

interface RawEntry {
  input: string
  senses: unknown[]
  variants?: unknown
  /** Synonyms for the one sense of this word that is kept because it has been studied. */
  kept_synonyms?: unknown
}

interface WordRow {
  id: number
  headword: string
  norm: string
  variants: string
}

interface Plan {
  problems: string[]
  warnings: string[]
  /** `kept` is how many studied or hand-edited senses the word already has. */
  saves: { word: WordRow; entry: EntryDraft; kept: number }[]
  keptFills: { senseId: number; synonyms: string[] }[]
}

const MAX_WORDS_IN_DEFINITION = 15

function loadEntries(dir: string): { entries: Map<string, RawEntry>; errors: string[] } {
  const entries = new Map<string, RawEntry>()
  const errors: string[] = []
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
  for (const file of files) {
    let list: unknown
    try {
      list = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    } catch (err) {
      errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    if (!Array.isArray(list)) {
      errors.push(`${file}: expected a list of entries`)
      continue
    }
    for (const item of list) {
      const e = item as Partial<RawEntry> | null
      if (!e || typeof e.input !== 'string' || !Array.isArray(e.senses)) {
        errors.push(`${file}: an item has no "input" or no "senses" list`)
        continue
      }
      const key = normKey(e.input)
      if (entries.has(key)) errors.push(`${file}: "${e.input}" is also in an earlier file`)
      entries.set(key, e as RawEntry)
    }
  }
  return { entries, errors }
}

function openCopy(source: string, target: string): DB {
  for (const suffix of ['', '-wal', '-shm']) rmSync(target + suffix, { force: true })
  copyFileSync(source, target)
  // A source copied while the app was running has its write-ahead log beside it.
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(source + suffix)) copyFileSync(source + suffix, target + suffix)
  }
  return openDatabase(target)
}

function wordCount(text: unknown): number {
  return typeof text === 'string' ? text.split(/\s+/).filter(Boolean).length : 0
}

// Everything a run would do, worked out without changing anything.
function plan(db: DB, entries: Map<string, RawEntry>, maxSenses: number, partial: boolean): Plan {
  const result: Plan = { problems: [], warnings: [], saves: [], keptFills: [] }
  const words = db
    .prepare('SELECT id, headword, norm, variants FROM words ORDER BY id')
    .all() as WordRow[]
  const known = new Set(words.map((w) => w.norm))
  for (const [key, e] of entries) {
    if (!known.has(key)) result.problems.push(`"${e.input}" matches no word in the database`)
  }

  const kept = new Map<number, number[]>()
  const keptRows = db
    .prepare(
      `SELECT s.id, s.word_id FROM senses s LEFT JOIN cards c ON c.sense_id = s.id
       WHERE COALESCE(c.reps, 0) > 0 OR s.user_edited = 1 ORDER BY s.word_id, s.ord`
    )
    .all() as { id: number; word_id: number }[]
  for (const row of keptRows) kept.set(row.word_id, [...(kept.get(row.word_id) ?? []), row.id])

  for (const word of words) {
    const label = `${word.headword} (#${word.id})`
    const raw = entries.get(word.norm)
    if (!raw) {
      if (!partial) result.problems.push(`${label}: no entry`)
      continue
    }
    const keptHere = kept.get(word.id) ?? []

    if (raw.kept_synonyms !== undefined) {
      if (keptHere.length !== 1) {
        result.problems.push(
          `${label}: kept_synonyms needs exactly one studied sense, but it has ${keptHere.length}`
        )
      } else {
        const given = cleanSynonyms(raw.kept_synonyms)
        const synonyms = cleanSynonyms(raw.kept_synonyms, (s) => !leakedForm(s, word.headword))
        if (given.length > synonyms.length || synonyms.length > 3) {
          result.problems.push(`${label}: kept_synonyms has a leak, a repeat or more than 3`)
        }
        result.keptFills.push({ senseId: keptHere[0], synonyms: synonyms.slice(0, 3) })
      }
    } else if (keptHere.length > 0) {
      result.warnings.push(`${label}: the studied sense gets no synonyms`)
    }

    if (raw.senses.length === 0) {
      if (keptHere.length === 0) result.problems.push(`${label}: no senses and nothing to keep`)
      continue
    }
    if (raw.senses.length > maxSenses - keptHere.length) {
      result.problems.push(
        `${label}: ${raw.senses.length} senses given, room for ${maxSenses - keptHere.length}`
      )
    }
    // An entry that says nothing about spelling variants keeps the ones the word has now: they are
    // what lets "synthesise" count for "synthesize" when it is typed into the blank.
    const stored = parseVariants(word.variants)
    const full =
      raw.variants === undefined && stored.length > 0 ? { ...raw, variants: stored } : raw
    // Check every sense given, not just those that fit.
    const check = checkEntry(full, word.headword, Math.max(maxSenses, raw.senses.length))
    result.problems.push(...check.problems.map((p) => `${label}: ${p}`))
    if (!check.entry || check.problems.length > 0) continue

    check.entry.senses.forEach((draft, i) => {
      const given = cleanSynonyms((raw.senses[i] as { synonyms?: unknown }).synonyms)
      const lost = given.filter((s) => !draft.synonyms.includes(s))
      if (lost.length > 0) {
        result.problems.push(`${label}: sense ${i + 1}: synonyms dropped (${lost.join(', ')})`)
      }
      if (wordCount(draft.defEn) > MAX_WORDS_IN_DEFINITION) {
        result.warnings.push(`${label}: sense ${i + 1}: def_en is ${wordCount(draft.defEn)} words`)
      }
    })
    result.saves.push({ word, entry: check.entry, kept: keptHere.length })
  }
  return result
}

function show(title: string, lines: string[], limit = 200): void {
  if (lines.length === 0) return
  console.log(`\n${title} (${lines.length}):`)
  for (const line of lines.slice(0, limit)) console.log(`  ${line}`)
  if (lines.length > limit) console.log(`  … and ${lines.length - limit} more`)
}

function count(db: DB, sql: string): number {
  return (db.prepare(sql).get() as { n: number }).n
}

function totals(db: DB): Record<string, number> {
  return {
    words: count(db, 'SELECT COUNT(*) AS n FROM words'),
    ready: count(db, "SELECT COUNT(*) AS n FROM words WHERE status = 'ready'"),
    senses: count(db, 'SELECT COUNT(*) AS n FROM senses'),
    cards: count(db, 'SELECT COUNT(*) AS n FROM cards'),
    studiedCards: count(db, 'SELECT COUNT(*) AS n FROM cards WHERE reps > 0'),
    reviewLogs: count(db, 'SELECT COUNT(*) AS n FROM review_logs'),
    withSynonyms: count(db, "SELECT COUNT(*) AS n FROM senses WHERE synonyms != '[]'")
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const partial = args.includes('--partial')
  const [command, dir, source, target, model = 'claude-sonnet-5-5'] = args.filter(
    (a) => a !== '--partial'
  )
  if ((command !== 'check' && command !== 'build') || !dir || !source) {
    console.error('usage: apply-entries.ts check <entries-dir> <database> [--partial]')
    console.error('       apply-entries.ts build <entries-dir> <database> <new-database> [model]')
    process.exit(2)
  }
  if (command === 'build' && !target) {
    console.error('build needs a <new-database> path')
    process.exit(2)
  }

  const { entries, errors } = loadEntries(dir)
  const scratch = mkdtempSync(join(tmpdir(), 'wordloom-entries-'))
  const file = command === 'build' ? target : join(scratch, 'check.db')
  const db = openCopy(source, file)
  try {
    const maxSenses = loadSettings(db).llm.maxSenses
    const before = totals(db)
    const p = plan(db, entries, maxSenses, partial)
    show('files that could not be read', errors)
    show('problems', p.problems)
    show('warnings', p.warnings, 40)
    console.log(
      `\n${entries.size} entries read for ${before.words} words; ${p.saves.length} to save, ` +
        `${p.keptFills.length} studied senses to fill with synonyms; maxSenses ${maxSenses}`
    )
    if (errors.length > 0 || p.problems.length > 0) {
      console.log('NOT OK')
      process.exitCode = 1
      return
    }
    if (command === 'check') {
      console.log('OK')
      return
    }

    const now = Date.now()
    const fill = db.prepare("UPDATE senses SET synonyms = ? WHERE id = ? AND synonyms = '[]'")
    db.transaction(() => {
      for (const { word, entry } of p.saves) {
        saveEnrichment(db, word.id, entry, {
          model,
          promptVersion: ENRICH_PROMPT_VERSION,
          maxSenses,
          now
        })
      }
      for (const f of p.keptFills) fill.run(JSON.stringify(f.synonyms), f.senseId)
    })()

    // The new file must keep everything that was studied, and be consistent.
    const after = totals(db)
    const noSense =
      'SELECT COUNT(*) AS n FROM words w WHERE NOT EXISTS (SELECT 1 FROM senses s WHERE s.word_id = w.id)'
    const noExample =
      'SELECT COUNT(*) AS n FROM senses s WHERE NOT EXISTS (SELECT 1 FROM examples e WHERE e.sense_id = s.id)'
    const checks: [string, boolean][] = [
      ['same number of words', after.words === before.words],
      ['every word ready', after.ready === after.words],
      ['same studied cards', after.studiedCards === before.studiedCards],
      ['same review history', after.reviewLogs === before.reviewLogs],
      ['one card per sense', after.cards === after.senses],
      ['every word has a sense', count(db, noSense) === 0],
      ['every sense has an example', count(db, noExample) === 0],
      ['integrity_check ok', db.pragma('integrity_check', { simple: true }) === 'ok'],
      ['foreign keys ok', (db.pragma('foreign_key_check') as unknown[]).length === 0]
    ]
    for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
    // saveEnrichment skips a new sense that repeats a studied one, or that has no room.
    const senseCount = db.prepare('SELECT COUNT(*) AS n FROM senses WHERE word_id = ?')
    const leftOut = p.saves.filter(({ word, entry, kept }) => {
      const has = (senseCount.get(word.id) as { n: number }).n
      return has < kept + entry.senses.length
    })
    show(
      'words where a new sense was left out',
      leftOut.map((s) => s.word.headword)
    )
    console.log(
      `\nsenses ${before.senses} -> ${after.senses} (${(after.senses / after.words).toFixed(2)} per word); ` +
        `with synonyms ${before.withSynonyms} -> ${after.withSynonyms} ` +
        `(${((100 * after.withSynonyms) / after.senses).toFixed(0)}%)`
    )
    if (checks.some(([, ok]) => !ok)) {
      console.log('NOT OK')
      process.exitCode = 1
      return
    }
    db.exec('VACUUM')
    db.pragma('wal_checkpoint(TRUNCATE)')
    console.log(`\nwritten: ${target} (model "${model}", prompt version ${ENRICH_PROMPT_VERSION})`)
  } finally {
    db.close()
    rmSync(scratch, { recursive: true, force: true })
    if (process.exitCode === 1 && command === 'build') {
      for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true })
    }
  }
}

main()
