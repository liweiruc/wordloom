import { lemmatize } from './lemmatize'
import type { Grade, Outcome } from './types'

export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[‐‑‒–—―]/g, '-')
    .trim()
    .replace(/[.!?,;:"]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Optimal-string-alignment distance: insertions, deletions, substitutions and swaps of two
// neighbouring letters each cost one, so "recieve" is one step from "receive".
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[a.length][b.length]
}

export interface AnswerTarget {
  cloze: string[]
  headword: string
  variants: string[]
}

// Hyphens and spaces are interchangeable in an answer: "self esteem" for "self-esteem".
function sameText(a: string, b: string): boolean {
  return a === b || a.replace(/[\s-]/g, '') === b.replace(/[\s-]/g, '')
}

function sameLemmas(a: string, b: string): boolean {
  const ta = a.split(' ')
  const tb = b.split(' ')
  return (
    ta.length === tb.length && ta.every((t, i) => t === tb[i] || lemmatize(t) === lemmatize(tb[i]))
  )
}

// Judges what the learner typed into a blank. The blank asks for the word in the form the
// sentence needs, so the base form where the sentence has "struck" is the right word in the
// wrong form, which is a different miss from not knowing the word at all.
export function judgeAnswer(
  input: string,
  target: AnswerTarget
): Exclude<Outcome, 'gave_up' | 'known'> {
  const given = normalizeAnswer(input)
  const expected = normalizeAnswer(target.cloze.join(' '))
  if (!given) return 'wrong'
  if (sameText(given, expected)) return 'correct'

  // A listed spelling variant is right too, inflection included: "odours" for "odors".
  const head = normalizeAnswer(target.headword)
  if (expected.startsWith(head)) {
    const ending = expected.slice(head.length)
    for (const variant of target.variants.map(normalizeAnswer)) {
      if (variant && sameText(given, variant + ending)) return 'correct'
    }
  }

  if (sameLemmas(given, expected) || sameText(given, head)) return 'wrong_form'

  const limit = expected.length >= 8 ? 2 : 1
  if (expected.length >= 4 && editDistance(given, expected) <= limit) return 'typo'
  return 'wrong'
}

/** The rating offered by default; the learner can always pick another one. */
export function suggestGrade(outcome: Outcome, hintsUsed: number): Grade {
  switch (outcome) {
    case 'correct':
      return hintsUsed > 0 ? 2 : 3
    case 'typo':
    case 'wrong_form':
      return 2
    case 'known':
      return 4
    default:
      return 1
  }
}
