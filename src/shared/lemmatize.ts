import nlp from 'compromise'

const cache = new Map<string, string>()

// Base form of a single English word: running→run, ran→run, children→child. compromise is
// slow to build a document, and the same words come up again and again (validation checks
// every definition token), so results are memoised.
export function lemmatize(word: string): string {
  const w = word.toLowerCase().trim()
  if (!w) return w
  const hit = cache.get(w)
  if (hit !== undefined) return hit
  const lemma = computeLemma(w)
  cache.set(w, lemma)
  return lemma
}

function computeLemma(w: string): string {
  const doc = nlp(w)

  // Verb infinitive: running→run, ran→run
  const verbs = doc.verbs()
  if (verbs.length > 0) {
    const inf = verbs.toInfinitive().text().trim()
    if (inf && inf !== w) return inf
  }

  // Adjective positive: handles some comparatives and superlatives
  const adjs = doc.adjectives() as unknown as {
    length: number
    toPositive?: () => { text(): string }
  }
  if (adjs.length > 0) {
    const pos = adjs.toPositive?.().text().trim()
    if (pos && pos !== w) return pos
  }

  // Noun singular: children→child, mice→mouse
  const nouns = doc.nouns()
  if (nouns.length > 0) {
    const singular = nouns.toSingular().text().trim()
    if (singular && singular !== w) return singular
  }

  return w
}
