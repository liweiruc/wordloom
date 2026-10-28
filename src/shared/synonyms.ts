// What may stand between two synonyms when they come back as one string.
const SEPARATORS = /[,;，；、\n]/

// Letters, spaces, hyphens and apostrophes: "squirm", "get rid of", "pull someone's leg".
const SYNONYM_RE = /^[A-Za-z][A-Za-z'’ -]*$/
const MAX_WORDS = 4

/**
 * Turns whatever came back for a sense's synonyms (a list, one comma-separated string, or
 * anything else) into a clean list: trimmed, English only, no repeats. Whatever is not a short
 * English word or phrase, or is refused by `allow`, is dropped, so one bad item costs only itself.
 */
export function cleanSynonyms(
  value: unknown,
  allow: (synonym: string) => boolean = () => true
): string[] {
  const seen = new Set<string>()
  const clean: string[] = []
  for (const item of Array.isArray(value) ? value : [value]) {
    if (typeof item !== 'string') continue
    for (const part of item.split(SEPARATORS)) {
      const synonym = part.replace(/^["“”\s]+|["“”.\s]+$/g, '').replace(/\s+/g, ' ')
      if (!SYNONYM_RE.test(synonym) || synonym.split(' ').length > MAX_WORDS) continue
      const key = synonym.toLowerCase()
      if (seen.has(key) || !allow(synonym)) continue
      seen.add(key)
      clean.push(synonym)
    }
  }
  return clean
}
