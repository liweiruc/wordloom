import type { FSRS } from 'ts-fsrs'
import type { StudySettings } from '../../shared/types'
import type { DB } from '../db/connection'
import { retrievability, type CardRow } from './scheduler'

export interface QueueEntry {
  cardId: number
  wordId: number
  kind: 'learning' | 'review' | 'new'
  due: number
}

export interface DayWindow {
  start: number
  end: number
}

/** The study day containing `now`; it starts at `dayStartHour` local time, not midnight. */
export function dayWindow(now: number, dayStartHour: number): DayWindow {
  const d = new Date(now)
  let start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), dayStartHour).getTime()
  if (now < start)
    start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, dayStartHour).getTime()
  const s = new Date(start)
  const end = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1, dayStartHour).getTime()
  return { start, end }
}

export interface TodayCounts {
  reviewsDone: number
  newDone: number
  touchedWords: Set<number>
}

export function todayCounts(db: DB, window: DayWindow): TodayCounts {
  const logs = db
    .prepare(
      'SELECT card_id, word_id, state_before FROM review_logs WHERE reviewed_at >= ? AND reviewed_at < ?'
    )
    .all(window.start, window.end) as { card_id: number; word_id: number; state_before: number }[]
  const newCards = new Set<number>()
  let reviewsDone = 0
  for (const log of logs) {
    if (log.state_before === 2) reviewsDone++
    if (log.state_before === 0) newCards.add(log.card_id)
  }
  return { reviewsDone, newDone: newCards.size, touchedWords: new Set(logs.map((l) => l.word_id)) }
}

export interface DailyQueue {
  entries: QueueEntry[]
  learning: number
  reviews: number
  newCards: number
  reviewsDone: number
  newDone: number
}

// Spreads new cards evenly between reviews instead of saving them all for the end.
export function interleave<T>(reviews: T[], fresh: T[]): T[] {
  if (fresh.length === 0) return [...reviews]
  if (reviews.length === 0) return [...fresh]
  const out: T[] = []
  const every = reviews.length / (fresh.length + 1)
  let r = 0
  fresh.forEach((card, k) => {
    const upto = Math.round((k + 1) * every)
    while (r < upto) out.push(reviews[r++])
    out.push(card)
  })
  while (r < reviews.length) out.push(reviews[r++])
  return out
}

// Today's cards, in the order they should come up. Each sense has its own card, but a word
// gets at most one of them per day: once one sense of "strike" has been asked, every other
// blank for it reads "strike" too, so its other due senses wait until tomorrow and its new
// senses are not introduced. Cards already in their learning steps are exempt; they have to
// be seen again today.
export function buildDailyQueue(
  db: DB,
  scheduler: FSRS,
  settings: StudySettings,
  now: number
): DailyQueue {
  const window = dayWindow(now, settings.dayStartHour)
  const today = todayCounts(db, window)
  const taken = new Set(today.touchedWords)
  const base = `SELECT c.* FROM cards c JOIN words w ON w.id = c.word_id WHERE w.status = 'ready' AND c.suspended = 0`

  const learningRows = db
    .prepare(`${base} AND c.state IN (1, 3) AND c.due < ? ORDER BY c.due`)
    .all(window.end) as CardRow[]
  const learning: QueueEntry[] = learningRows.map((r) => ({
    cardId: r.id,
    wordId: r.word_id,
    kind: 'learning',
    due: r.due
  }))
  for (const r of learningRows) taken.add(r.word_id)

  // Most-forgotten first, so a review limit cuts the cards that can best afford to wait.
  const reviewRows = db
    .prepare(`${base} AND c.state = 2 AND c.due < ?`)
    .all(window.end) as CardRow[]
  const scored = reviewRows
    .map((row) => ({ row, r: retrievability(scheduler, row, now) ?? 0 }))
    .sort((a, b) => a.r - b.r)
  const reviewLimit = Math.max(0, settings.reviewsPerDay - today.reviewsDone)
  const reviews: QueueEntry[] = []
  for (const { row } of scored) {
    if (reviews.length >= reviewLimit) break
    if (taken.has(row.word_id)) continue
    taken.add(row.word_id)
    reviews.push({ cardId: row.id, wordId: row.word_id, kind: 'review', due: row.due })
  }

  const newLimit = Math.max(0, settings.newPerDay - today.newDone)
  const fresh: QueueEntry[] = []
  if (newLimit > 0) {
    const rows = db
      .prepare(
        `SELECT c.id, c.word_id, c.new_rank, s.ord FROM cards c
         JOIN senses s ON s.id = c.sense_id JOIN words w ON w.id = c.word_id
         WHERE w.status = 'ready' AND c.suspended = 0 AND c.state = 0`
      )
      .all() as { id: number; word_id: number; new_rank: number; ord: number }[]
    // Ranks are random in [0, 1), except that a word added from 查词 has its cards moved to
    // [-1, 0): it was looked up because it was needed, so it is introduced first.
    if (settings.newOrder === 'by-word') {
      // A word ranks by its lowest card, which already puts looked-up words first.
      const wordRank = new Map<number, number>()
      for (const row of rows)
        wordRank.set(row.word_id, Math.min(wordRank.get(row.word_id) ?? 1, row.new_rank))
      rows.sort((a, b) => wordRank.get(a.word_id)! - wordRank.get(b.word_id)! || a.ord - b.ord)
    } else {
      // Looked-up words, then every word's main sense first; within a rank the order is
      // random, which keeps look-alike neighbours from an alphabetical list (synthesis,
      // syntax) apart.
      rows.sort(
        (a, b) =>
          Number(a.new_rank >= 0) - Number(b.new_rank >= 0) ||
          a.ord - b.ord ||
          a.new_rank - b.new_rank
      )
    }
    for (const row of rows) {
      if (fresh.length >= newLimit) break
      if (taken.has(row.word_id)) continue
      taken.add(row.word_id)
      fresh.push({ cardId: row.id, wordId: row.word_id, kind: 'new', due: now })
    }
  }

  return {
    entries: [...learning, ...interleave(reviews, fresh)],
    learning: learning.length,
    reviews: reviews.length,
    newCards: fresh.length,
    reviewsDone: today.reviewsDone,
    newDone: today.newDone
  }
}
