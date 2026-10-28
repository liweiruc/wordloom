import { readFileSync } from 'fs'
import { resolve } from 'path'
import iconv from 'iconv-lite'
import { describe, expect, it } from 'vitest'
import { commitImport } from '../src/main/import/commit'
import { decodeText } from '../src/main/import/decode'
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
