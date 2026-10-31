import { readFileSync } from 'fs'
import { resolve } from 'path'
import iconv from 'iconv-lite'
import { describe, expect, it } from 'vitest'
import { commitImport, IMPORTED_MODEL } from '../src/main/import/commit'
import { readEntriesFile } from '../src/main/import/entries'
import { countByStatus, saveEnrichment } from '../src/main/library/words'
import { decodeText } from '../src/shared/decode'
import type { EntryDraft } from '../src/shared/types'
import { cleanHeadword } from '../src/main/import/normalize'
import {
  detectFormat,
  leadingEnglish,
  parseDictExport,
  parseFreeText,
  parseLineList,
  splitLines
} from '../src/main/import/parsers'
import { buildPreview } from '../src/main/import/preview'
import { openDatabase } from '../src/main/db/connection'
import { entry, sense } from './helpers'

const NOW = new Date(2026, 9, 31, 10, 0, 0).getTime()

const sampleBytes = readFileSync(resolve(process.cwd(), 'tests/fixtures/20261025.txt'))

describe('dictionary word-book export (the sample file)', () => {
  const { text, encoding } = decodeText(sampleBytes)
  const lines = splitLines(text)
  const headwords = parseDictExport(lines).map((c) => c.headword)

  it('is decoded from UTF-16 (what Windows calls "Unicode") and detected as a dictionary export', () => {
    expect(encoding).toBe('UTF-16 LE')
    expect(detectFormat(lines)).toBe('dictExport')
  })

  it('extracts exactly the 626 numbered headwords, in file order', () => {
    expect(headwords).toHaveLength(626)
    expect(new Set(headwords.map((h) => h.toLowerCase())).size).toBe(626)
    expect(headwords[0]).toBe('yield to')
    expect(headwords[2]).toBe('wrinkle')
    expect(headwords.at(-1)).toBe('abrupt')
  })

  it('keeps phrases, hyphenated compounds and proper nouns intact', () => {
    for (const expected of [
      'yield to',
      'whipping boy',
      'suck up to',
      'give or take',
      'in light of',
      'pay-as-you-go',
      'ready-made',
      'hard-won',
      'self esteem',
      'Jerusalem',
      'Fahrenheit',
      'ambiguity'
    ]) {
      expect(headwords).toContain(expected)
    }
  })

  it('lower-cases shouted entries', () => {
    expect(headwords).toContain('reptile')
    expect(headwords).toContain('hyperbole')
    expect(headwords).toContain('exaggerated')
    expect(headwords).not.toContain('REPTILE')
  })

  it('takes nothing from definition or date lines', () => {
    // These only ever appear inside definitions ("truncate 的过去分词", "(the whip)",
    // "null （Stray）…", "（同 milk sickness）") or as part-of-speech labels.
    for (const stray of [
      'truncate',
      'the',
      'null',
      'milk',
      'geothermal',
      'savoury',
      'selfy',
      'pend',
      'v',
      'n'
    ]) {
      expect(headwords).not.toContain(stray)
    }
    expect(headwords.some((h) => /\d/.test(h))).toBe(false)
  })
})

describe('leadingEnglish', () => {
  it.each([
    ['abandon v. 放弃', 'abandon'],
    ['give up vt.放弃', 'give up'],
    ['apple n 苹果', 'apple'],
    ['wrinkle  [ˈrɪŋk(ə)l]  英译中', 'wrinkle'],
    ['self-esteem n. 自尊', 'self-esteem'],
    ['word,meaning', 'word'],
    ['word\tmeaning', 'word'],
    ['e.g. 例如', 'e.g.'],
    ['v.产生（收益、效益等）', ''],
    ['【名】 （Wavy）威维（人名）', '']
  ])('%s → %s', (line, expected) => {
    expect(leadingEnglish(line)).toBe(expected)
  })
})

describe('line lists and free text', () => {
  it('reads one headword per line and skips everything else', () => {
    const lines = [
      'apple',
      'banana 香蕉',
      'give up v. 放弃',
      '',
      '中文行',
      'pay-as-you-go adj. 预付费的'
    ]
    expect(detectFormat(lines)).toBe('lineList')
    expect(parseLineList(lines).map((c) => c.headword)).toEqual([
      'apple',
      'banana',
      'give up',
      'pay-as-you-go'
    ])
  })

  it('mines base forms from prose and drops function words', () => {
    const lines = [
      'The children were running quickly through the parks, and nobody noticed.',
      'It was the kind of morning that makes everything feel possible again.'
    ]
    expect(detectFormat(lines)).toBe('freeText')
    const words = parseFreeText(lines).map((c) => c.headword)
    expect(words).toContain('child')
    expect(words).toContain('run')
    expect(words).toContain('park')
    expect(words).not.toContain('the')
    expect(words).not.toContain('were')
  })
})

describe('decodeText', () => {
  it('handles a UTF-8 byte-order mark', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('apple 苹果', 'utf8')])
    expect(decodeText(buf)).toEqual({ text: 'apple 苹果', encoding: 'UTF-8 (BOM)' })
  })

  it('falls back to GB18030 for GBK files', () => {
    const buf = iconv.encode('1, wrinkle  英译中\nn. 皱纹\n', 'gbk')
    const { text, encoding } = decodeText(buf)
    expect(encoding).toBe('GB18030')
    expect(text).toContain('皱纹')
    expect(parseDictExport(splitLines(text)).map((c) => c.headword)).toEqual(['wrinkle'])
  })

  it('handles UTF-16 LE with a byte-order mark', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('tile 瓷砖', 'utf16le')])
    expect(decodeText(buf).text).toBe('tile 瓷砖')
  })

  it('takes a plain Uint8Array, which is what the browser hands over', () => {
    expect(decodeText(new TextEncoder().encode('apple 苹果'))).toEqual({
      text: 'apple 苹果',
      encoding: 'UTF-8'
    })
    expect(decodeText(new Uint8Array(iconv.encode('皱纹', 'gbk'))).text).toBe('皱纹')
  })
})

describe('cleanHeadword', () => {
  it.each([
    ['REPTILE', 'reptile'],
    ['Jerusalem', 'Jerusalem'],
    ['apple,', 'apple'],
    ['  self   esteem ', 'self esteem'],
    ['pay–as–you–go', 'pay-as-you-go'],
    ['e.g.', 'e.g.'],
    ['end.', 'end'],
    ['don’t', "don't"]
  ])('%s → %s', (raw, expected) => {
    expect(cleanHeadword(raw)).toBe(expected)
  })
})

describe('preview and commit', () => {
  it('dedupes, flags known words and links them instead of recreating them', () => {
    const db = openDatabase(':memory:')
    const first = commitImport(db, {
      listName: 'first',
      sourceFile: null,
      items: [{ headword: 'threshold' }, { headword: 'harass' }]
    })
    expect(first).toMatchObject({ created: 2, linked: 0 })

    const preview = buildPreview(db, [
      { name: 'b.txt', encoding: 'UTF-8', text: 'threshold\nwiggle\nWiggle\nharass' }
    ])
    expect(
      preview.candidates.map((c) => [c.headword, c.occurrences, c.existingWordId !== null])
    ).toEqual([
      ['threshold', 1, true],
      ['wiggle', 2, false],
      ['harass', 1, true]
    ])

    const second = commitImport(db, {
      listName: 'second',
      sourceFile: 'b.txt',
      items: preview.candidates.map((c) => ({ headword: c.headword }))
    })
    expect(second).toMatchObject({ created: 1, linked: 2 })
    const count = db.prepare('SELECT COUNT(*) AS n FROM words').get() as { n: number }
    expect(count.n).toBe(3)
  })

  it('adds to an existing list of the same name instead of creating another', () => {
    const db = openDatabase(':memory:')
    const a = commitImport(db, {
      listName: '20261025',
      sourceFile: null,
      items: [{ headword: 'wiggle' }]
    })
    const b = commitImport(db, {
      listName: '20261025',
      sourceFile: null,
      items: [{ headword: 'wrinkle' }, { headword: 'wiggle' }]
    })
    expect(b.listId).toBe(a.listId)
    expect(db.prepare('SELECT COUNT(*) AS n FROM lists').get()).toEqual({ n: 1 })
    const positions = db.prepare('SELECT position FROM list_words ORDER BY position').all()
    expect(positions).toEqual([{ position: 0 }, { position: 1 }])
  })
})

// A second sense of "wiggle" that passes the checks, and one that gives the word away.
const noun = sense({
  pos: 'n.',
  def_en: 'a small quick movement',
  def_zh: '扭动',
  example_en: 'She gave a little wiggle of her hips.',
  cloze: ['wiggle']
})
const leaky = sense({ def_en: 'to wiggle from side to side' })

function tile(defEn: string): EntryDraft {
  return {
    headword: 'tile',
    ipaUk: '/taɪl/',
    ipaUs: '/taɪl/',
    variants: [],
    senses: [
      {
        pos: 'n.',
        defEn,
        defZh: '瓷砖',
        synonyms: [],
        register: 'neutral',
        exampleEn: 'One tile in the bathroom is cracked.',
        exampleZh: '浴室里有一块瓷砖裂了。',
        cloze: ['tile']
      }
    ]
  }
}

describe('entries files', () => {
  it('reads a list of entries, a reply object, and a reply copied out of a chat', () => {
    const wiggle = entry('wiggle', [sense()])
    for (const text of [
      JSON.stringify([wiggle], null, 2),
      JSON.stringify({ entries: [wiggle] }),
      `Here are the entries:\n\n\`\`\`json\n${JSON.stringify({ entries: [wiggle] })}\n\`\`\`\n\nWant more?`
    ]) {
      const file = readEntriesFile(text, 4)
      expect(file?.skipped).toEqual([])
      expect(file?.items).toHaveLength(1)
      expect(file?.items[0]).toMatchObject({
        headword: 'wiggle',
        position: 1,
        fileEntry: { given: 1, problems: [] }
      })
      expect(file?.items[0].fileEntry?.entry?.senses[0]).toMatchObject({
        defZh: '扭动；摆动',
        cloze: ['wiggle']
      })
    }
  })

  it('leaves word lists, prose and text that only opens with a bracket to the other formats', () => {
    for (const text of [
      'apple\nbanana',
      '[Chorus]\nI wanna dance with somebody',
      '1, wrinkle  [ˈrɪŋk(ə)l]  英译中\nn. 皱纹',
      'The children were running through the parks.'
    ]) {
      expect(readEntriesFile(text, 4)).toBeNull()
    }
  })

  it('says why JSON it cannot use is not imported', () => {
    expect(() => readEntriesFile('[{"input": "wiggle", "senses": [', 4)).toThrow(/读不出来/)
    expect(() => readEntriesFile('{"app": "wordloom", "words": []}', 4)).toThrow(/不是词条/)
  })

  it('checks every entry the way a generated one is checked', () => {
    const file = readEntriesFile(
      JSON.stringify([
        entry('wiggle', [sense(), leaky]),
        // Written for another word: no sense passes for "tile".
        entry('tile', [sense()]),
        'harass',
        { input: 'threshold', senses: [] },
        { input: 'café' },
        42
      ]),
      4
    )
    expect(file?.items.map((i) => [i.headword, i.position])).toEqual([
      ['wiggle', 1],
      ['tile', 2],
      ['harass', 3],
      ['threshold', 4]
    ])
    const [wiggle, tileItem, harass, threshold] = file?.items ?? []
    expect(wiggle.fileEntry?.given).toBe(2)
    expect(wiggle.fileEntry?.entry?.senses).toHaveLength(1)
    expect(wiggle.fileEntry?.problems).toEqual([
      expect.stringMatching(/^sense 2: def_en gives the answer away/)
    ])
    expect(tileItem.fileEntry).toMatchObject({ entry: null, given: 1 })
    expect(tileItem.fileEntry?.problems.join(' ')).toMatch(/not the headword "tile"/)
    expect(harass.fileEntry).toBeNull()
    expect(threshold.fileEntry).toBeNull()
    expect(file?.skipped).toEqual(['第 5 项「café」不是英文单词或短语', '第 6 项不是词条'])
  })

  it('imports no more senses than a word may have, and says so', () => {
    const file = readEntriesFile(JSON.stringify([entry('wiggle', [sense(), noun, noun])]), 1)
    expect(file?.items[0].fileEntry?.entry?.senses).toHaveLength(1)
    expect(file?.items[0].fileEntry?.problems).toEqual([
      'senses 2–3 were left out: a word has at most 1 (see Settings)'
    ])
  })

  it('previews an entries file as a format of its own, against what the library has', () => {
    const db = openDatabase(':memory:')
    commitImport(db, { listName: 'old', sourceFile: null, items: [{ headword: 'harass' }] })
    const text = JSON.stringify({ entries: [entry('wiggle', [sense(), noun]), 'harass'] })
    const preview = buildPreview(db, [{ name: 'e.json', encoding: 'UTF-8', text }], undefined, 1)
    expect(preview).toMatchObject({ format: 'entries', detected: 'entries', skipped: [] })
    expect(preview.sources).toEqual([
      { name: 'e.json', encoding: 'UTF-8', lines: 1, format: 'entries' }
    ])
    expect(
      preview.candidates.map((c) => [
        c.headword,
        c.existingStatus,
        c.fileEntry?.entry?.senses.length ?? null
      ])
    ).toEqual([
      ['wiggle', null, 1],
      ['harass', 'pending', null]
    ])
  })

  it('gives a word from a word list the entry an entries file imported with it has', () => {
    const preview = buildPreview(
      openDatabase(':memory:'),
      [
        { name: 'list.txt', encoding: 'UTF-8', text: 'wiggle\nthreshold\nwiggle' },
        { name: 'e.json', encoding: 'UTF-8', text: JSON.stringify([entry('wiggle', [sense()])]) }
      ],
      'lineList'
    )
    expect(preview).toMatchObject({ format: 'lineList', detected: 'lineList' })
    expect(preview.sources.map((s) => s.format)).toEqual(['lineList', 'entries'])
    const [wiggle, threshold] = preview.candidates
    expect(wiggle).toMatchObject({ source: 'list.txt', line: 1, occurrences: 3 })
    expect(wiggle.fileEntry?.entry?.headword).toBe('wiggle')
    expect(threshold.fileEntry).toBeNull()
  })
})

describe('committing entries', () => {
  const wiggle = (): EntryDraft => {
    const file = readEntriesFile(JSON.stringify([entry('wiggle', [sense(), noun])]), 4)
    const draft = file?.items[0].fileEntry?.entry
    if (!draft) throw new Error('the wiggle entry should pass')
    return draft
  }

  it('saves a word that brings its entry ready to study, and leaves the rest to the generator', () => {
    const db = openDatabase(':memory:')
    const result = commitImport(
      db,
      {
        listName: 'e',
        sourceFile: 'e.json',
        items: [{ headword: 'wiggle', entry: wiggle() }, { headword: 'tile' }]
      },
      NOW,
      4
    )
    expect(result).toMatchObject({ created: 2, linked: 0, filled: 1, queued: 1 })
    expect(db.prepare('SELECT headword, status, llm_model FROM words ORDER BY id').all()).toEqual([
      { headword: 'wiggle', status: 'ready', llm_model: IMPORTED_MODEL },
      { headword: 'tile', status: 'pending', llm_model: null }
    ])
    expect(db.prepare('SELECT COUNT(*) AS n FROM cards').get()).toEqual({ n: 2 })
  })

  it('fills a library word still waiting for its entry, and keeps the entry a word has', () => {
    const db = openDatabase(':memory:')
    commitImport(db, {
      listName: 'old',
      sourceFile: null,
      items: [{ headword: 'wiggle' }, { headword: 'tile' }]
    })
    const { id } = db.prepare("SELECT id FROM words WHERE norm = 'tile'").get() as { id: number }
    saveEnrichment(db, id, tile('a flat square piece used to cover floors'), {
      model: 'deepseek-chat',
      promptVersion: 2,
      maxSenses: 4,
      now: NOW
    })
    const result = commitImport(
      db,
      {
        listName: 'new',
        sourceFile: 'e.json',
        items: [
          { headword: 'wiggle', entry: wiggle() },
          { headword: 'tile', entry: tile('a thin square piece of baked clay') }
        ]
      },
      NOW,
      4
    )
    expect(result).toMatchObject({ created: 0, linked: 2, filled: 1, queued: 0 })
    expect(countByStatus(db)).toMatchObject({ ready: 2, pending: 0 })
    expect(db.prepare('SELECT def_en FROM senses WHERE word_id = ?').all(id)).toEqual([
      { def_en: 'a flat square piece used to cover floors' }
    ])
  })

  it('never saves an entry under a word it was not written for', () => {
    const db = openDatabase(':memory:')
    const result = commitImport(
      db,
      { listName: 'e', sourceFile: null, items: [{ headword: 'tile', entry: wiggle() }] },
      NOW,
      4
    )
    expect(result).toMatchObject({ created: 1, filled: 0, queued: 1 })
    expect(countByStatus(db)).toMatchObject({ pending: 1, ready: 0 })
  })
})
