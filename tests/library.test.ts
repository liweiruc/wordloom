import { describe, expect, it } from 'vitest'
import { exportCsv, exportJson } from '../src/main/data/export'
import { openDatabase, type DB } from '../src/main/db/connection'
import { migrate, SCHEMA_VERSION } from '../src/main/db/migrations'
import { DEFAULT_SETTINGS } from '../src/main/db/settings'
import { commitImport } from '../src/main/import/commit'
import { getWordDetail, saveEnrichment, updateSense } from '../src/main/library/words'
import type { SenseDraft } from '../src/main/llm/validate'
import { makeScheduler } from '../src/main/srs/scheduler'
import { loadCardContent } from '../src/main/srs/session'

const NOW = new Date(2026, 9, 25, 10, 0, 0).getTime()
const scheduler = makeScheduler({ ...DEFAULT_SETTINGS.study })
// The CSV starts with a byte-order mark so that Excel reads the Chinese as UTF-8.
const BOM = String.fromCharCode(0xfeff)

function sense(pos: string, defEn: string, synonyms: string[]): SenseDraft {
  return {
    pos,
    defEn,
    defZh: '释义',
    synonyms,
    register: 'neutral',
    exampleEn: 'Try not to wiggle during the photo.',
    exampleZh: '拍照时别乱动。',
    cloze: ['wiggle']
  }
}

// A word with two senses: one with synonyms and one without.
function wiggle(): { db: DB; wordId: number } {
  const db = openDatabase(':memory:')
  commitImport(db, { listName: 'l', sourceFile: null, items: [{ headword: 'wiggle' }] }, NOW)
  const { id } = db.prepare('SELECT id FROM words').get() as { id: number }
  saveEnrichment(
    db,
    id,
    {
      headword: 'wiggle',
      ipaUk: '/x/',
      ipaUs: '/x/',
      variants: [],
      senses: [
        sense('v.', 'to move with small quick movements', ['squirm', 'twist']),
        sense('n.', 'a small quick movement', [])
      ]
    },
    { model: 'm', promptVersion: 2, maxSenses: 4, now: NOW }
  )
  return { db, wordId: id }
}

describe('synonyms in the library', () => {
  it('are stored with each sense and read back', () => {
    const { db, wordId } = wiggle()
    const detail = getWordDetail(db, scheduler, wordId, NOW)
    expect(detail.senses.map((s) => s.synonyms)).toEqual([['squirm', 'twist'], []])
  })

  it('can be replaced, tidied and cleared by hand', () => {
    const { db, wordId } = wiggle()
    const first = (): ReturnType<typeof getWordDetail>['senses'][number] =>
      getWordDetail(db, scheduler, wordId, NOW).senses[0]

    updateSense(db, first().id, { synonyms: ['rebuff', ' snub ', '扭动', 'Rebuff'] })
    expect(first().synonyms).toEqual(['rebuff', 'snub'])
    expect(first().userEdited).toBe(true)

    // Leaving the field out changes nothing; an empty list is a real edit.
    updateSense(db, first().id, { defZh: '别的释义' })
    expect(first().synonyms).toEqual(['rebuff', 'snub'])
    updateSense(db, first().id, { synonyms: [] })
    expect(first().synonyms).toEqual([])
  })

  it('go onto the study card, for its sense and for the other senses', () => {
    const { db } = wiggle()
    const { id } = db
      .prepare('SELECT c.id FROM cards c JOIN senses s ON s.id = c.sense_id WHERE s.ord = 0')
      .get() as { id: number }
    const card = loadCardContent(db, id)
    expect(card?.synonyms).toEqual(['squirm', 'twist'])
    expect(card?.otherSenses).toEqual([
      { pos: 'n.', defEn: 'a small quick movement', defZh: '释义', synonyms: [] }
    ])
  })

  it('are in the exports', () => {
    const { db } = wiggle()
    const json = JSON.parse(exportJson(db)) as { words: { senses: { synonyms: string[] }[] }[] }
    expect(json.words[0].senses.map((s) => s.synonyms)).toEqual([['squirm', 'twist'], []])

    const [header, row] = exportCsv(db).replace(BOM, '').split('\r\n')
    expect(header.split(',')).toContain('synonyms')
    expect(row).toContain('squirm; twist')
  })

  it('start out empty for a database made before they existed', () => {
    const db = openDatabase(':memory:')
    // Put the database back the way version 1 left it, with a sense already in it.
    db.exec('ALTER TABLE senses DROP COLUMN synonyms')
    db.exec('DROP TABLE lookups')
    db.pragma('user_version = 1')
    db.exec("INSERT INTO words (headword, norm, created_at) VALUES ('wiggle', 'wiggle', 0)")
    db.exec(
      "INSERT INTO senses (word_id, ord, pos, def_en, def_zh) VALUES (1, 0, 'v.', 'to move', '扭动')"
    )

    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(db.prepare('SELECT synonyms FROM senses').get()).toEqual({ synonyms: '[]' })
  })
})
