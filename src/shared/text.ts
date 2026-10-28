// One English word, keeping contractions and hyphenated compounds whole.
export const WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g

const CJK_RE = /[㐀-鿿豈-﫿]/

export function hasCjk(text: string): boolean {
  return CJK_RE.test(text)
}

/** The lower-case form two headwords are compared by. */
export function normKey(headword: string): string {
  return headword.toLowerCase()
}

export function englishTokens(text: string): string[] {
  return text.toLowerCase().match(WORD_RE) ?? []
}
