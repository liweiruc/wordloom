import type { FileEntry } from '../../shared/types'
import { checkEntry } from '../llm/validate'
import { cleanHeadword, isHeadwordLike } from './normalize'

// An entries file holds finished entries, written by hand or by a model in a chat, in the shape
// the generation prompt asks for: a list of {input, ipa_uk, ipa_us, variants, senses: [...]},
// or the {"entries": [...]} the model replies with. Each entry is checked exactly as a generated
// one is, and what passes is imported as it is instead of being generated. An item without
// senses, or a bare string, is only a headword.

export interface EntryItem {
  headword: string
  /** The item's position in the file, from 1. */
  position: number
  fileEntry: FileEntry | null
}

export interface EntriesFile {
  items: EntryItem[]
  /** Items that hold no usable headword. */
  skipped: string[]
}

// A reply copied out of a chat keeps its ```json fence, often with a sentence around it.
const FENCE_RE = /```[^\n`]*\n([\s\S]*?)```/g

// The start of a JSON list or object, as opposed to text that merely opens with a bracket
// ("[Chorus]").
const JSON_START_RE = /^(?:\[\s*[{"\]]|\{\s*["}])/

function jsonBlocks(text: string): string[] {
  const fenced = [...text.matchAll(FENCE_RE)].map((m) => m[1].trim())
  return (fenced.length > 0 ? fenced : [text.trim()]).filter((b) => JSON_START_RE.test(b))
}

function letterCount(text: string): number {
  return text.normalize('NFKC').match(/\p{L}/gu)?.length ?? 0
}

function itemsOf(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  const v = value as Record<string, unknown> | null
  if (v && typeof v === 'object') {
    if (Array.isArray(v.entries)) return v.entries
    if (Array.isArray(v.senses)) return [v]
  }
  return null
}

function checkFileEntry(
  item: Record<string, unknown>,
  headword: string,
  given: number,
  maxSenses: number
): FileEntry {
  const check = checkEntry(item, headword, maxSenses)
  const problems = [...check.problems]
  if (given > maxSenses) {
    const left =
      given === maxSenses + 1 ? `sense ${given} was` : `senses ${maxSenses + 1}–${given} were`
    problems.push(`${left} left out: a word has at most ${maxSenses} (see Settings)`)
  }
  return { entry: check.entry, given, problems }
}

/** Null when `text` is not an entries file. Throws when it looks like one but cannot be used. */
export function readEntriesFile(text: string, maxSenses: number): EntriesFile | null {
  const blocks = jsonBlocks(text)
  if (blocks.length === 0) return null
  const raw: unknown[] = []
  for (const block of blocks) {
    let value: unknown
    try {
      value = JSON.parse(block)
    } catch (err) {
      throw new Error(`这段 JSON 读不出来：${err instanceof Error ? err.message : String(err)}`, {
        cause: err
      })
    }
    const items = itemsOf(value)
    if (!items) {
      throw new Error('这段 JSON 不是词条：需要词条的列表 [...]，或者 {"entries": [...]}。')
    }
    raw.push(...items)
  }

  const file: EntriesFile = { items: [], skipped: [] }
  raw.forEach((value, i) => {
    const position = i + 1
    const item = (typeof value === 'string' ? { input: value } : value) as Record<
      string,
      unknown
    > | null
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      file.skipped.push(`第 ${position} 项不是词条`)
      return
    }
    const word = [item.input, item.headword].find((v): v is string => typeof v === 'string')
    const headword = cleanHeadword(word ?? '')
    // Clean-up only tidies punctuation and spacing; a word it had to cut letters from ("café"
    // would become "caf") is not one the entry was written for.
    if (!isHeadwordLike(headword) || letterCount(headword) !== letterCount(word ?? '')) {
      file.skipped.push(
        word ? `第 ${position} 项「${word}」不是英文单词或短语` : `第 ${position} 项没有词头`
      )
      return
    }
    const senses = Array.isArray(item.senses) ? item.senses.length : 0
    file.items.push({
      headword,
      position,
      fileEntry: senses > 0 ? checkFileEntry(item, headword, senses, maxSenses) : null
    })
  })
  return file
}
