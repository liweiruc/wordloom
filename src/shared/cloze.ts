const LETTER = /\p{L}/u

// Curly and straight apostrophes count as the same character. The replacement keeps the
// length, so an index found in the folded copy is valid in the original sentence.
function fold(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'")
}

// The first place `needle` stands as whole words at or after `from`, not inside a longer
// word: "ran" must not be found in "Fran", nor "art" in "start". Cards blank whatever is
// found, and half a word would leave the rest of it on screen ("I'm ___ning late").
export function findWhole(haystack: string, needle: string, from = 0): number {
  if (!needle) return -1
  for (let at = haystack.indexOf(needle, from); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    const before = haystack[at - 1]
    const after = haystack[at + needle.length]
    if (!(before && LETTER.test(before)) && !(after && LETTER.test(after))) return at
  }
  return -1
}

export interface ClozeSegment {
  text: string
  blank: boolean
}

// Splits an example sentence around the parts a card blanks, in order: one part for
// "struck", two for a split phrasal verb ("ripped" … "off"). Returns null when a part
// cannot be found as whole words after the previous one. The generator's validator rejects
// such examples, so null only shows up for a sentence someone edited by hand.
export function splitCloze(sentence: string, parts: string[]): ClozeSegment[] | null {
  const folded = fold(sentence)
  const segments: ClozeSegment[] = []
  let cursor = 0
  for (const raw of parts) {
    const part = raw.trim()
    if (!part) return null
    const at = findWhole(folded, fold(part), cursor)
    if (at < 0) return null
    if (at > cursor) segments.push({ text: sentence.slice(cursor, at), blank: false })
    segments.push({ text: sentence.slice(at, at + part.length), blank: true })
    cursor = at + part.length
  }
  if (cursor < sentence.length) segments.push({ text: sentence.slice(cursor), blank: false })
  return segments
}

/** "w _ _ _ _ _" per blanked part: the first letter and the length, nothing more. */
export function letterHint(parts: string[]): string {
  return parts
    .map((part) =>
      part
        .trim()
        .split(/\s+/)
        .map((word) =>
          [...word].map((ch, i) => (i === 0 || !/[A-Za-z]/.test(ch) ? ch : '_')).join(' ')
        )
        .join('   ')
    )
    .join('   …   ')
}

/** The text the learner has to type: every blanked part, joined by single spaces. */
export function clozeAnswer(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
}
