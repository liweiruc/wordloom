import type { WordKind } from '../../shared/types'

// Tidies a headword as extracted from a list: Unicode forms, curly quotes, dashes, stray
// edge punctuation. Shouted entries (REPTILE, HYPERBOLE) are ordinary words and become
// lower case; mixed case such as "Jerusalem" is left alone for the clean-up step, which can
// tell a proper noun from a capitalised list entry.
export function cleanHeadword(raw: string): string {
  let s = raw
    .normalize('NFKC')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  s = s.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z.']+$/, '')
  // Keep the dots of abbreviations such as "e.g." but drop a sentence-final one.
  if (!/^(?:[a-z]\.){2,}$/i.test(s)) s = s.replace(/[.']+$/, '')
  if (s.length > 1 && s === s.toUpperCase() && /[A-Z]/.test(s)) s = s.toLowerCase()
  return s
}

const HEADWORD_RE = /^[A-Za-z][A-Za-z' .-]*$/

/** Something that could be a dictionary headword: Latin letters, at most six words. */
export function isHeadwordLike(s: string): boolean {
  if (!s || s.length > 60 || !HEADWORD_RE.test(s)) return false
  return s.split(' ').length <= 6
}

export function wordKind(headword: string): WordKind {
  return headword.includes(' ') ? 'phrase' : 'word'
}
