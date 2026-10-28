import { normKey } from '../../shared/text'
import type { ImportFormat, ImportSource, ParsePreview, PreviewCandidate } from '../../shared/types'
import type { DB } from '../db/types'
import { detectFormat, parseLines, splitLines } from './parsers'

// Parses one or more sources into a deduplicated candidate list. Each source detects its
// own format unless the learner forces one; repeats keep their first position and are
// counted, and words already in the library are flagged so they are linked, not regenerated.
export function buildPreview(db: DB, sources: ImportSource[], format?: ImportFormat): ParsePreview {
  const byNorm = new Map<string, PreviewCandidate>()
  const sourceInfo: ParsePreview['sources'] = []
  let detected: ImportFormat | null = null

  for (const source of sources) {
    const lines = splitLines(source.text)
    const own = detectFormat(lines)
    detected ??= own
    sourceInfo.push({ name: source.name, encoding: source.encoding, lines: lines.length })
    for (const raw of parseLines(lines, format ?? own)) {
      const norm = normKey(raw.headword)
      const seen = byNorm.get(norm)
      if (seen) {
        seen.occurrences++
        continue
      }
      byNorm.set(norm, {
        headword: raw.headword,
        norm,
        line: raw.line,
        source: source.name,
        occurrences: 1,
        existingWordId: null
      })
    }
  }

  const candidates = [...byNorm.values()]
  const lookup = db.prepare('SELECT id FROM words WHERE norm = ?')
  for (const candidate of candidates) {
    const row = lookup.get(candidate.norm) as { id: number } | undefined
    candidate.existingWordId = row?.id ?? null
  }

  const resolved = detected ?? 'lineList'
  return { format: format ?? resolved, detected: resolved, sources: sourceInfo, candidates }
}
