import { normKey } from '../../shared/text'
import type {
  FileEntry,
  ImportSource,
  ParsePreview,
  PreviewCandidate,
  TextFormat,
  WordStatus
} from '../../shared/types'
import { DEFAULT_SETTINGS } from '../db/settings'
import type { DB } from '../db/types'
import { readEntriesFile } from './entries'
import { detectFormat, parseLines, splitLines } from './parsers'

// Parses one or more sources into a deduplicated candidate list. An entries file is read as
// one; any other source detects its own format unless the learner forces one. Repeats keep
// their first position and are counted, and words already in the library are flagged so they
// are linked, not regenerated.
export function buildPreview(
  db: DB,
  sources: ImportSource[],
  format?: TextFormat,
  maxSenses = DEFAULT_SETTINGS.llm.maxSenses
): ParsePreview {
  const byNorm = new Map<string, PreviewCandidate>()
  const sourceInfo: ParsePreview['sources'] = []
  const skipped: string[] = []
  let detected: TextFormat | null = null

  const add = (
    headword: string,
    line: number,
    source: string,
    fileEntry: FileEntry | null
  ): void => {
    const norm = normKey(headword)
    const seen = byNorm.get(norm)
    if (seen) {
      seen.occurrences++
      // A word listed in a word list takes its entry from an entries file imported with it; of
      // two entries, the first one that can be used wins.
      if (fileEntry && !seen.fileEntry?.entry && (fileEntry.entry || !seen.fileEntry)) {
        seen.fileEntry = fileEntry
      }
      return
    }
    byNorm.set(norm, {
      headword,
      norm,
      line,
      source,
      occurrences: 1,
      existingWordId: null,
      existingStatus: null,
      fileEntry
    })
  }

  for (const source of sources) {
    const lines = splitLines(source.text)
    const info = { name: source.name, encoding: source.encoding, lines: lines.length }
    const entries = readEntriesFile(source.text, maxSenses)
    if (entries) {
      sourceInfo.push({ ...info, format: 'entries' })
      skipped.push(...entries.skipped.map((note) => `${source.name}：${note}`))
      for (const item of entries.items) {
        add(item.headword, item.position, source.name, item.fileEntry)
      }
      continue
    }
    const own = detectFormat(lines)
    detected ??= own
    sourceInfo.push({ ...info, format: format ?? own })
    for (const raw of parseLines(lines, format ?? own)) {
      add(raw.headword, raw.line, source.name, null)
    }
  }

  const candidates = [...byNorm.values()]
  const lookup = db.prepare('SELECT id, status FROM words WHERE norm = ?')
  for (const candidate of candidates) {
    const row = lookup.get(candidate.norm) as { id: number; status: WordStatus } | undefined
    candidate.existingWordId = row?.id ?? null
    candidate.existingStatus = row?.status ?? null
  }

  // Only text sources have a format to choose; entries files alone have none.
  if (!detected && sourceInfo.length > 0) {
    return { format: 'entries', detected: 'entries', sources: sourceInfo, candidates, skipped }
  }
  const resolved = detected ?? 'lineList'
  return {
    format: format ?? resolved,
    detected: resolved,
    sources: sourceInfo,
    candidates,
    skipped
  }
}
