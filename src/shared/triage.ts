import { normKey } from './text'
import type { TriageItem } from './types'

// What the clean-up suggests learning instead: the base form of a pure inflection, the right
// spelling, the standard form. Inflections that are words in their own right stay, and for a
// plain word or a name only a change of capitalisation is taken.
export function suggestedHeadword(original: string, t: TriageItem): string {
  switch (t.kind) {
    case 'inflection':
      return t.keepSeparate ? original : t.suggestion
    case 'misspelling':
    case 'variant':
      return t.suggestion
    case 'ok':
    case 'proper_noun':
      return normKey(t.suggestion.trim()) === normKey(original.trim()) ? t.suggestion : original
    default:
      return original
  }
}
