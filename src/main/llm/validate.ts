import { clozeAnswer, splitCloze } from '../../shared/cloze'
import { lemmatize } from '../../shared/lemmatize'
import { cleanSynonyms } from '../../shared/synonyms'
import { englishTokens, hasCjk, normKey } from '../../shared/text'
import type { EntryDraft, Register, SenseDraft } from '../../shared/types'
import { cleanHeadword, isHeadwordLike } from '../import/normalize'
import { MAX_SYNONYMS } from './prompts/enrich'
import { rawEntrySchema, rawSenseSchema, type RawSense } from './schemas'

export type { EntryDraft, SenseDraft }

/**
 * `entry` holds the senses that passed, or null when none did. `problems` lists everything
 * that failed, worded for the model: they go back to it verbatim in a repair request.
 */
export interface EntryCheck {
  entry: EntryDraft | null
  problems: string[]
}

const POS_ALIASES: Record<string, string> = {
  n: 'n.',
  noun: 'n.',
  v: 'v.',
  verb: 'v.',
  vt: 'v.',
  vi: 'v.',
  adj: 'adj.',
  adjective: 'adj.',
  adv: 'adv.',
  adverb: 'adv.',
  prep: 'prep.',
  preposition: 'prep.',
  conj: 'conj.',
  conjunction: 'conj.',
  pron: 'pron.',
  pronoun: 'pron.',
  det: 'det.',
  determiner: 'det.',
  num: 'num.',
  number: 'num.',
  numeral: 'num.',
  int: 'int.',
  interj: 'int.',
  interjection: 'int.',
  exclamation: 'int.',
  'phr. v': 'phr. v.',
  'phr.v': 'phr. v.',
  'phr v': 'phr. v.',
  'phrasal verb': 'phr. v.',
  idiom: 'idiom',
  phrase: 'phrase',
  phr: 'phrase'
}

export function normalizePos(pos: string): string {
  const key = pos.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '')
  return POS_ALIASES[key] ?? pos.trim()
}

const REGISTERS: readonly Register[] = ['neutral', 'formal', 'informal', 'slang']

function normalizeRegister(value: string | undefined): Register {
  const r = (value ?? '').trim().toLowerCase() as Register
  return REGISTERS.includes(r) ? r : 'neutral'
}

function normalizeIpa(value: string | undefined): string {
  const core = (value ?? '')
    .trim()
    .replace(/^[/[]+|[/\]]+$/g, '')
    .trim()
  return core ? `/${core}/` : ''
}

// Particles and pronouns that phrases share with everything ("give UP", "suck up TO"):
// meeting one of them in a definition gives nothing away.
const PHRASE_FILLER = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'in',
  'on',
  'at',
  'up',
  'off',
  'out',
  'down',
  'over',
  'for',
  'with',
  'by',
  'as',
  'or',
  'and',
  'one',
  "one's",
  'oneself',
  'someone',
  'something',
  'somebody',
  'your',
  'yourself',
  'it',
  'be',
  'is'
])

function headwordTokens(headword: string): string[] {
  const tokens = englishTokens(headword)
  if (tokens.length <= 1) return tokens
  const content = tokens.filter((t) => !PHRASE_FILLER.has(t))
  return content.length > 0 ? content : tokens
}

function commonPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

// The word in `text` that would hand the learner the answer, if any: the headword itself,
// one of its forms ("wiggling" for "wiggle"), or a close relative sharing most of its stem
// ("resilience" for "resilient").
export function leakedForm(text: string, headword: string): string | null {
  const tokens = englishTokens(text)
  for (const head of headwordTokens(headword)) {
    const headLemma = lemmatize(head)
    for (const token of tokens) {
      if (token === head || lemmatize(token) === headLemma) return token
      if (head.length >= 5 && token.length >= 5) {
        const shared = commonPrefix(token, head)
        if (shared >= 5 && shared >= Math.ceil(Math.min(token.length, head.length) * 0.7)) {
          return token
        }
      }
    }
  }
  return null
}

// The blank has to hold the headword, not some other word of the sentence: its first word
// must be a form of the headword's first word, or at least start the same way.
function clozeIsHeadword(cloze: string[], headword: string): boolean {
  const answer = englishTokens(clozeAnswer(cloze))
  const head = englishTokens(headword)
  if (answer.length === 0 || head.length === 0) return false
  const a = answer[0]
  const h = head[0]
  return a === h || lemmatize(a) === lemmatize(h) || a.slice(0, 2) === h.slice(0, 2)
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function checkSense(
  raw: RawSense,
  headword: string
): { draft: SenseDraft | null; problems: string[] } {
  const problems: string[] = []
  const defEn = raw.def_en.trim()
  const defZh = raw.def_zh.trim()
  const exampleEn = raw.example_en.trim()
  const exampleZh = raw.example_zh.trim()
  const cloze = (Array.isArray(raw.cloze) ? raw.cloze : [raw.cloze])
    .map((p) => p.trim())
    .filter(Boolean)

  if (!defEn) problems.push('def_en is empty')
  else {
    if (hasCjk(defEn)) problems.push('def_en must be English only')
    if (wordCount(defEn) > 25)
      problems.push(`def_en is too long (${wordCount(defEn)} words; keep it within 15)`)
    const leak = leakedForm(defEn, headword)
    if (leak)
      problems.push(
        `def_en gives the answer away by using "${leak}"; define it without the headword or any form or relative of it`
      )
  }
  if (!hasCjk(defZh)) problems.push('def_zh must be Chinese')
  if (!exampleEn) problems.push('example_en is empty')
  else if (hasCjk(exampleEn)) problems.push('example_en must be English only')
  if (!hasCjk(exampleZh)) problems.push('example_zh must be a Chinese translation')

  if (cloze.length === 0) problems.push('cloze is empty')
  else if (exampleEn) {
    const segments = splitCloze(exampleEn, cloze)
    if (!segments) {
      problems.push(
        `cloze ${JSON.stringify(cloze)} does not appear in example_en as whole words, in order; copy the headword exactly as it is written in the sentence`
      )
    } else if (!clozeIsHeadword(cloze, headword)) {
      problems.push(`cloze ${JSON.stringify(cloze)} is not the headword "${headword}"`)
    } else {
      // The blank hides one occurrence; a second one left in the sentence gives it away.
      const rest = segments
        .filter((s) => !s.blank)
        .map((s) => s.text)
        .join(' ')
      const leak = leakedForm(rest, headword)
      if (leak)
        problems.push(`example_en uses "${leak}" outside the blank; use the headword only once`)
    }
  }

  if (problems.length > 0) return { draft: null, problems }
  // Synonyms are an extra clue, never a reason to reject a sense: one that would give the
  // answer away, or is malformed, is dropped quietly instead of costing a repair call.
  const synonyms = cleanSynonyms(raw.synonyms, (s) => !leakedForm(s, headword)).slice(
    0,
    MAX_SYNONYMS
  )
  return {
    draft: {
      pos: normalizePos(raw.pos),
      defEn,
      defZh,
      synonyms,
      register: normalizeRegister(raw.register),
      exampleEn,
      exampleZh,
      cloze
    },
    problems
  }
}

export function checkEntry(raw: unknown, input: string, maxSenses: number): EntryCheck {
  const parsed = rawEntrySchema.safeParse(raw)
  if (!parsed.success) {
    return { entry: null, problems: ['the entry must be an object with a "senses" list'] }
  }
  const e = parsed.data
  const problems: string[] = []

  // The model may fix capitalisation ("fahrenheit" -> "Fahrenheit") but not swap the word.
  const suggested = cleanHeadword(e.headword ?? '')
  const headword = suggested && normKey(suggested) === normKey(input) ? suggested : input

  const ipaUk = normalizeIpa(e.ipa_uk)
  const ipaUs = normalizeIpa(e.ipa_us)
  if (!ipaUk && !ipaUs) problems.push('ipa_uk and ipa_us are both empty')

  if (e.senses.length === 0) problems.push('no senses were given')
  const senses: SenseDraft[] = []
  e.senses.slice(0, maxSenses).forEach((rawSense, i) => {
    const label = `sense ${i + 1}`
    const sense = rawSenseSchema.safeParse(rawSense)
    if (!sense.success) {
      problems.push(
        `${label}: missing or invalid fields (pos, def_en, def_zh, example_en, example_zh, cloze are all required)`
      )
      return
    }
    const result = checkSense(sense.data, headword)
    if (result.draft) senses.push(result.draft)
    else problems.push(...result.problems.map((p) => `${label}: ${p}`))
  })

  const variants = [...new Set((e.variants ?? []).map(cleanHeadword))].filter(
    (v) => isHeadwordLike(v) && normKey(v) !== normKey(headword)
  )

  return {
    entry:
      senses.length > 0
        ? { headword, ipaUk: ipaUk || ipaUs, ipaUs: ipaUs || ipaUk, variants, senses }
        : null,
    problems
  }
}
