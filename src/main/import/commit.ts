import { normKey } from '../../shared/text'
import type { CommitRequest, CommitResult } from '../../shared/types'
import type { DB } from '../db/types'
import { cleanHeadword, isHeadwordLike, wordKind } from './normalize'

// Writes the confirmed import: a list (an existing one if the name matches, so importing a
// file again adds to its list), a pending word for every headword not yet in the library,
// and a link from the list to every word, old or new. The generator picks the pending words
// up from there.
export function commitImport(db: DB, req: CommitRequest, now = Date.now()): CommitResult {
  const findList = db.prepare('SELECT id FROM lists WHERE name = ? ORDER BY id LIMIT 1')
  const nextPosition = db.prepare(
    'SELECT COALESCE(MAX(position) + 1, 0) AS next FROM list_words WHERE list_id = ?'
  )
  const insertList = db.prepare(
    'INSERT INTO lists (name, source_file, created_at) VALUES (?, ?, ?)'
  )
  const findWord = db.prepare('SELECT id FROM words WHERE norm = ?')
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
    let position = (nextPosition.get(listId) as { next: number }).next
    for (const item of req.items) {
      const headword = cleanHeadword(item.headword)
      if (!isHeadwordLike(headword)) continue
      const norm = normKey(headword)
      if (seen.has(norm)) continue
      seen.add(norm)
      const existing = findWord.get(norm) as { id: number } | undefined
      let wordId: number
      if (existing) {
        wordId = existing.id
        linked++
      } else {
        const kind = item.kind ?? wordKind(headword)
        wordId = Number(insertWord.run(headword, norm, kind, now).lastInsertRowid)
        created++
      }
      link.run(listId, wordId, position++)
    }
    return { listId, created, linked }
  })()
}
