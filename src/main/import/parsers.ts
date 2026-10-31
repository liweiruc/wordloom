import { lemmatize } from '../../shared/lemmatize'
import { hasCjk, WORD_RE } from '../../shared/text'
import type { TextFormat } from '../../shared/types'
import { cleanHeadword, isHeadwordLike } from './normalize'

export interface RawCandidate {
  headword: string
  /** 1-based line number of this occurrence. */
  line: number
}

// "12, yield to    英译中" and "3. wrinkle [ˈrɪŋk(ə)l]": a numbered entry line, as written by
// dictionary word-book exports. Only these lines carry headwords; everything between them
// is definition text.
const HEADER_RE = /^\s*\d+\s*[,，、.．)）:：]\s*(.+?)\s*$/

// The English words a line starts with, stopping at whatever follows the headword in a
// list: phonetics, a tab or comma, Chinese, a part-of-speech label.
const LEAD_RE = /^[A-Za-z][A-Za-z'’.-]*(?: +[A-Za-z][A-Za-z'’.-]*)*/

const POS_LABELS = new Set([
  'n',
  'v',
  'vt',
  'vi',
  'adj',
  'adv',
  'prep',
  'conj',
  'pron',
  'int',
  'interj',
  'num',
  'art',
  'abbr',
  'aux',
  'det',
  'pl',
  'phr'
])

function isPosLabel(token: string): boolean {
  return POS_LABELS.has(token.replace(/\.$/, '').toLowerCase())
}

export function leadingEnglish(text: string): string {
  const t = text.trim()
  const m = LEAD_RE.exec(t)
  if (!m) return ''
  const tokens = m[0].split(/ +/)
  const rest = t.slice(m[0].length)
  // A part-of-speech label after the headword: "abandon v. 放弃", "give up vt.放弃",
  // "apple n 苹果". Without a dot it only counts when non-English text follows.
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1]
    if (isPosLabel(last) && (last.endsWith('.') || rest === '' || /^\s*[^A-Za-z\s]/.test(rest))) {
      tokens.pop()
    } else {
      break
    }
  }
  // A line holding nothing but a label ("v.产生…") is definition text, not a headword.
  if (tokens.length === 1 && isPosLabel(tokens[0]) && tokens[0].endsWith('.')) return ''
  return tokens.join(' ')
}

function headerHeadword(line: string): string | null {
  const m = HEADER_RE.exec(line)
  if (!m) return null
  // A 中译英 entry has a Chinese headword: nothing English to take.
  const lead = leadingEnglish(m[1])
  if (!lead) return null
  const headword = cleanHeadword(lead)
  return isHeadwordLike(headword) ? headword : null
}

export function parseDictExport(lines: string[]): RawCandidate[] {
  const out: RawCandidate[] = []
  lines.forEach((line, i) => {
    const headword = headerHeadword(line)
    if (headword) out.push({ headword, line: i + 1 })
  })
  return out
}

function lineHeadword(line: string): string | null {
  if (!/^\s*[A-Za-z]/.test(line)) return null
  const headword = cleanHeadword(leadingEnglish(line))
  return isHeadwordLike(headword) ? headword : null
}

export function parseLineList(lines: string[]): RawCandidate[] {
  const out: RawCandidate[] = []
  lines.forEach((line, i) => {
    const headword = lineHeadword(line)
    if (headword) out.push({ headword, line: i + 1 })
  })
  return out
}

// Function words and the commonest verbs: never worth a card when mining a passage.
const STOPWORDS = new Set(
  `a about above after again against all also am an and any are as at be because been before
  being below between both but by can could did do does doing down during each few for from
  further had has have having he her here hers herself him himself his how i if in into is it
  its itself just me more most my myself no nor not now of off on once only or other our ours
  ourselves out over own same she should so some such than that the their theirs them
  themselves then there these they this those through to too under until up very was we were
  what when where which while who whom why will with would you your yours yourself yourselves
  get got go goes went gone say said make made one two three like also may might must shall
  let yes oh ok okay mr mrs ms dr etc`.split(/\s+/)
)

export function parseFreeText(lines: string[]): RawCandidate[] {
  const out: RawCandidate[] = []
  lines.forEach((line, i) => {
    for (const match of line.matchAll(WORD_RE)) {
      const token = match[0]
      // Contractions ("don't", "it's") and very short tokens are never study words.
      if (token.length < 3 || /['’]/.test(token)) continue
      const lower = token.toLowerCase()
      if (STOPWORDS.has(lower)) continue
      const lemma = lemmatize(lower)
      if (STOPWORDS.has(lemma) || lemma.length < 3) continue
      out.push({ headword: lemma, line: i + 1 })
    }
  })
  return out
}

export function detectFormat(lines: string[]): TextFormat {
  const nonEmpty = lines.filter((line) => line.trim() && !hasCjkOnly(line))
  const all = lines.filter((line) => line.trim())
  if (all.length === 0) return 'lineList'
  const headers = all.filter((line) => headerHeadword(line) !== null).length
  if (headers >= 3 && headers >= all.length * 0.15) return 'dictExport'
  if (nonEmpty.length === 0) return 'lineList'
  const listy = nonEmpty.filter(
    (line) => lineHeadword(line) !== null && line.trim().length <= 80
  ).length
  if (listy >= nonEmpty.length * 0.6) return 'lineList'
  return 'freeText'
}

function hasCjkOnly(line: string): boolean {
  return hasCjk(line) && !/[A-Za-z]/.test(line)
}

export function parseLines(lines: string[], format: TextFormat): RawCandidate[] {
  switch (format) {
    case 'dictExport':
      return parseDictExport(lines)
    case 'lineList':
      return parseLineList(lines)
    case 'freeText':
      return parseFreeText(lines)
  }
}

export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/)
}
