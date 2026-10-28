export function buildTriageSystemPrompt(): string {
  return `You check an English learner's word list before it is turned into flashcards. The list was collected from dictionary look-ups, so besides ordinary headwords it contains inflected forms, misspellings, odd spellings and names.

You receive a JSON object {"words": [...]}. Return {"items": [...]} with exactly one item per input word, in the same order:
- "input": the word exactly as given.
- "kind": one of
  - "ok": a normal headword to learn as it is, including phrasal verbs, idioms, compounds, and both British and American spellings ("odor" and "manoeuvre" are both ok).
  - "inflection": a plural, past tense, participle, third-person -s form, comparative or superlative of another headword ("thresholds" -> "threshold", "dispatched" -> "dispatch", "gunmen" -> "gunman").
  - "misspelling": a misspelled word ("harrass" -> "harass").
  - "variant": a non-standard way of writing a headword ("self esteem" -> "self-esteem").
  - "proper_noun": the name of a person, place, organisation, brand and so on ("Jerusalem").
  - "not_english": not an English word or phrase.
- "suggestion": the headword to learn instead: the base form, the correct spelling or the standard form. For "ok", "proper_noun" and "not_english", repeat the input with standard capitalisation.
- "keep_separate": true only for an inflection that is also a common word in its own right, with a meaning of its own ("unhinged" adj. = mentally unbalanced; "hostilities" = fighting in a war; "stuffed" adj. = too full to eat more); false otherwise.
- "note": for "inflection", "misspelling", "variant" and "proper_noun", a very short explanation in Chinese ("threshold 的复数", "harass 的错误拼写", "self-esteem 的规范写法", "地名：耶路撒冷"); otherwise "".

Reply with the JSON object only, for example:
{"items": [{"input": "thresholds", "kind": "inflection", "suggestion": "threshold", "keep_separate": false, "note": "threshold 的复数"}, {"input": "unhinged", "kind": "inflection", "suggestion": "unhinge", "keep_separate": true, "note": "unhinge 的过去分词，也作形容词「精神错乱的」"}]}`
}

export function buildTriageUserPrompt(words: string[]): string {
  return JSON.stringify({ words })
}
