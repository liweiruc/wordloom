import { normKey } from '../../shared/text'
import type { CommitRequest, CommitResult, WordStatus } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../db/settings'
import type { DB } from '../db/types'
import { saveEnrichment } from '../library/words'
import { ENRICH_PROMPT_VERSION } from '../llm/prompts/enrich'
import { cleanHeadword, isHeadwordLike, wordKind } from './normalize'

/** What words.llm_model holds for an entry that came from an entries file. */
export const IMPORTED_MODEL = 'imported'

// Writes the confirmed import: a list (an existing one if the name matches, so importing a
// file again adds to its list), a pending word for every headword not yet in the library, and
// a link from the list to every word, old or new. The generator picks the pending words up
// from there, except those that came with an entry from an entries file: it is saved at once,
// as a generated one would be.
export function commitImport(
  db: DB,
  req: CommitRequest,
  now = Date.now(),
  maxSenses = DEFAULT_SETTINGS.llm.maxSenses
): CommitResult {
  const findList = db.prepare('SELECT id FROM lists WHERE name = ? ORDER BY id LIMIT 1')
  const nextPosition = db.prepare(
    'SELECT COALESCE(MAX(position) + 1, 0) AS next FROM list_words WHERE list_id = ?'
  )
  const insertList = db.prepare(
    'INSERT INTO lists (name, source_file, created_at) VALUES (?, ?, ?)'
  )
  const findWord = db.prepare('SELECT id, status FROM words WHERE norm = ?')
  const insertWord = db.prepare(
    "INSERT INTO words (headword, norm, kind, status, created_at) VALUES (?, ?, ?, 'pending', ?)"
  )
  const link = db.prepare(
    'INSERT OR IGNORE INTO list_words (list_id, word_id, position) VALUES (?, ?, ?)'
  )

  return db.transaction(() => {
    const name = req.listName.trim() || '未命名词表'
    const existingList = findList.get(name) as { id: number } | undefined
    const listId =
      existingList?.id ?? Number(insertList.run(name, req.sourceFile, now).lastInsertRowid)
    const seen = new Set<string>()
    let created = 0
    let linked = 0
    let filled = 0
    let queued = 0
    let position = (nextPosition.get(listId) as { next: number }).next
    for (const item of req.items) {
      const headword = cleanHeadword(item.headword)
      if (!isHeadwordLike(headword)) continue
      const norm = normKey(headword)
      if (seen.has(norm)) continue
      seen.add(norm)
      const existing = findWord.get(norm) as { id: number; status: WordStatus } | undefined
      let wordId: number
      if (existing) {
        wordId = existing.id
        linked++
      } else {
        const kind = item.kind ?? wordKind(headword)
        wordId = Number(insertWord.run(headword, norm, kind, now).lastInsertRowid)
        created++
      }
      // The file's entry goes to a new word, or one still waiting for an entry of its own; a
      // word that has one keeps it.
      if (item.entry && normKey(item.entry.headword) === norm && existing?.status !== 'ready') {
        saveEnrichment(db, wordId, item.entry, {
          model: IMPORTED_MODEL,
          promptVersion: ENRICH_PROMPT_VERSION,
          maxSenses,
          now
        })
        filled++
      } else if (!existing) {
        queued++
      }
      link.run(listId, wordId, position++)
    }
    return { listId, created, linked, filled, queued }
  })()
}
