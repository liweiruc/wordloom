// Bump when the prompt starts producing something the app relies on. Words remember the
// version they were generated with; older entries are never regenerated wholesale.
export const ENRICH_PROMPT_VERSION = 2

/** The most synonyms asked for per sense, and the most kept. */
export const MAX_SYNONYMS = 3

// Shown to the model as the shape to copy. DeepSeek's JSON mode asks for an example of the
// wanted output in the prompt, and a worked one also pins down the trickier rules: a
// definition that avoids the headword, an inflected blank, a split phrasal verb. It goes into
// the prompt minified: the model copies the layout of the example, and every indent it writes
// is billed as output.
const EXAMPLE_OUTPUT = {
  entries: [
    {
      input: 'wrinkle',
      headword: 'wrinkle',
      ipa_uk: '/ˈrɪŋ.kəl/',
      ipa_us: '/ˈrɪŋ.kəl/',
      variants: [],
      senses: [
        {
          pos: 'n.',
          def_en: 'a small line in the skin that appears as people get older',
          def_zh: '皱纹',
          synonyms: ['crease', 'line'],
          register: 'neutral',
          example_en: 'My grandma laughs so much that she has deep wrinkles around her eyes.',
          example_zh: '我奶奶特别爱笑，眼角都有了很深的皱纹。',
          cloze: ['wrinkles']
        },
        {
          pos: 'n.',
          def_en: 'a small problem or difficulty that still needs fixing',
          def_zh: '小问题；小麻烦',
          synonyms: ['hitch', 'snag', 'glitch'],
          register: 'informal',
          example_en: 'The plan is good, but there are still a few wrinkles we need to iron out.',
          example_zh: '计划不错，但还有几个小问题需要解决。',
          cloze: ['wrinkles']
        },
        {
          pos: 'v.',
          def_en: 'to make lines or folds appear in skin or cloth',
          def_zh: '（使）起皱；皱起',
          synonyms: ['crease'],
          register: 'neutral',
          example_en: 'She wrinkled her nose when she smelled the old milk.',
          example_zh: '她闻到变质的牛奶时皱起了鼻子。',
          cloze: ['wrinkled']
        }
      ]
    },
    {
      input: 'rip off',
      headword: 'rip off',
      ipa_uk: '/ˌrɪp ˈɒf/',
      ipa_us: '/ˌrɪp ˈɑːf/',
      variants: [],
      senses: [
        {
          pos: 'phr. v.',
          def_en: 'to cheat someone by making them pay too much',
          def_zh: '敲竹杠；宰（客）',
          synonyms: ['swindle', 'overcharge', 'con'],
          register: 'informal',
          example_en: 'That taxi driver totally ripped us off. It should have cost half that.',
          example_zh: '那个出租车司机把我们狠狠宰了一顿，本来只要一半的钱。',
          cloze: ['ripped', 'off']
        },
        {
          pos: 'phr. v.',
          def_en: "to copy someone else's idea or work and use it as your own",
          def_zh: '剽窃；抄袭',
          synonyms: ['plagiarize'],
          register: 'informal',
          example_en: 'Fans say the new song rips off a hit from the nineties.',
          example_zh: '歌迷们说这首新歌抄袭了一首九十年代的热门歌曲。',
          cloze: ['rips off']
        }
      ]
    }
  ]
}

export function buildEnrichSystemPrompt(maxSenses: number): string {
  return `You write study cards for an adult Chinese learner of English, in the style of a good English–Chinese learner's dictionary. The learner meets English in everyday life (TV shows, podcasts, news, social media, work) and later reviews each sense by filling a blank in an example sentence, with the English definition and its synonyms as the only clues.

You receive a JSON object {"words": [...]} listing headwords: single words, phrasal verbs, idioms or compound nouns. Return one entry per headword, in the same order, inside one JSON object {"entries": [...]}.

Entry fields:
- "input": the headword exactly as given.
- "headword": the standard dictionary form of that same headword; usually identical to the input (only fix capitalisation, e.g. "fahrenheit" -> "Fahrenheit").
- "ipa_uk", "ipa_us": British and American IPA between slashes, e.g. "/ˈrɪŋ.kəl/". For a multi-word headword, transcribe the whole phrase.
- "variants": other accepted spellings of the headword (British or American spelling, hyphenation), or [] if there are none.
- "senses": at most ${maxSenses} senses — the most common ones in modern everyday English, most common first. Leave out rare, archaic, dialect and narrowly technical senses, and senses that exist only as a person's or place's name, unless that is how the word is mainly used. Senses with the same part of speech must be next to each other. If the word really has only one or two common meanings, give only those.

Sense fields:
- "pos": one of "n.", "v.", "adj.", "adv.", "prep.", "conj.", "pron.", "det.", "num.", "int.", "phr. v.", "idiom", "phrase".
- "def_en": a clear definition in plain everyday English, at most 15 words, like a learner's dictionary. Never use the headword itself or any form or relative of it (for "resilient" do not write "resilience"; for "wiggle" do not write "wiggly"), and never explain it with words harder than the headword. The learner has to recall the headword from this definition, so it must not give the word away.
- "def_zh": natural Chinese equivalents; separate alternatives with "；".
- "synonyms": up to ${MAX_SYNONYMS} common English synonyms of this sense, most natural first: single words or short phrases of the same part of speech that could replace the headword in a sentence. They are shown to the learner as clues, so never the headword or any form or relative of it. Use [] when there is no true synonym; do not stretch to a loose match.
- "register": exactly one of "neutral", "formal", "informal", "slang".
- "example_en": exactly one natural sentence for this sense, the kind people really say or write today. Keep the other words simple. The context must make this sense unmistakable, so that someone who knows the word could fill it in from the sentence and the definition alone. Use the headword exactly once, and no other word built on it.
- "cloze": the exact text of the headword as it appears in example_en, inflection included ("struck", "running", "yielded to"). It is a list: normally a single string; only when other words split a phrase, give its parts in order (["ripped", "off"] for "They ripped me off."). Every part must appear in example_en as whole words, character for character.
- "example_zh": a fluent, natural Chinese translation of example_en, not word for word.

Reply with the JSON object only, minified on a single line, with no markdown fences and no commentary.

Example input:
{"words": ["wrinkle", "rip off"]}

Example output:
${JSON.stringify(EXAMPLE_OUTPUT)}`
}

export function buildEnrichUserPrompt(words: string[]): string {
  return JSON.stringify({ words })
}

export function buildRepairUserPrompt(word: string, problems: string[]): string {
  return `${JSON.stringify({ words: [word] })}

Your previous answer for "${word}" had these problems:
${problems.map((p) => `- ${p}`).join('\n')}

Return the complete corrected entry for this headword, following every rule above, as {"entries": [...]}.`
}
