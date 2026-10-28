import { z } from 'zod'

// Envelopes are checked first and their items one at a time, so one malformed entry or
// sense costs only itself, not the whole batch.

export const enrichReplySchema = z.object({ entries: z.array(z.unknown()) })

export const rawEntrySchema = z.object({
  input: z.string().optional(),
  headword: z.string().optional(),
  ipa_uk: z.string().optional(),
  ipa_us: z.string().optional(),
  variants: z.array(z.string()).optional(),
  senses: z.array(z.unknown())
})

export const rawSenseSchema = z.object({
  pos: z.string(),
  def_en: z.string(),
  def_zh: z.string(),
  // Read leniently by cleanSynonyms: a bad value costs the synonyms, never the sense.
  synonyms: z.unknown().optional(),
  register: z.string().optional(),
  example_en: z.string(),
  example_zh: z.string(),
  cloze: z.union([z.array(z.string()), z.string()])
})

export type RawSense = z.infer<typeof rawSenseSchema>

export const triageReplySchema = z.object({ items: z.array(z.unknown()) })

export const rawTriageItemSchema = z.object({
  input: z.string(),
  kind: z
    .enum(['ok', 'inflection', 'misspelling', 'variant', 'proper_noun', 'not_english'])
    .catch('ok'),
  suggestion: z.string().catch(''),
  keep_separate: z.boolean().catch(false),
  note: z.string().catch('')
})
