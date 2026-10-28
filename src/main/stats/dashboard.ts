import type { FSRS } from 'ts-fsrs'
import {
  MATURE_DAYS,
  type AppSettings,
  type DailyStat,
  type Dashboard,
  type TodayOverview
} from '../../shared/types'
import type { DB } from '../db/connection'
import { listSummaries } from '../library/words'
import { buildDailyQueue, dayWindow } from '../srs/queue'
import { retrievability, type CardRow } from '../srs/scheduler'

const DAY = 86_400_000
const HOUR = 3_600_000

/** "YYYY-MM-DD" of the study day a timestamp belongs to (days start at `dayStartHour`). */
export function dayKey(ms: number, dayStartHour: number): string {
  const d = new Date(ms - dayStartHour * HOUR)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// The same day key computed in SQLite; 'localtime' uses the system time zone, as Date does.
const sqlDay = (column: string): string =>
  `strftime('%Y-%m-%d', (${column} - @offset) / 1000, 'unixepoch', 'localtime')`

/** Day keys from `days - 1` days before today up to today, oldest first. */
function recentDays(now: number, dayStartHour: number, days: number): string[] {
  const { start } = dayWindow(now, dayStartHour)
  const keys: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const s = new Date(start)
    keys.push(
      dayKey(
        new Date(s.getFullYear(), s.getMonth(), s.getDate() - i, dayStartHour).getTime(),
        dayStartHour
      )
    )
  }
  return keys
}

export function computeStreak(db: DB, dayStartHour: number, now: number): number {
  const rows = db
    .prepare(
      `SELECT DISTINCT ${sqlDay('reviewed_at')} AS day FROM review_logs WHERE reviewed_at >= @since`
    )
    .all({ offset: dayStartHour * HOUR, since: now - 400 * DAY }) as { day: string }[]
  const days = new Set(rows.map((r) => r.day))
  const keys = recentDays(now, dayStartHour, 400).reverse()
  // Nothing studied yet today does not break the streak until the day is over.
  let i = days.has(keys[0]) ? 0 : 1
  let streak = 0
  while (i < keys.length && days.has(keys[i])) {
    streak++
    i++
  }
  return streak
}

export function todayOverview(
  db: DB,
  scheduler: FSRS,
  settings: AppSettings,
  now = Date.now()
): TodayOverview {
  const { dayStartHour } = settings.study
  const queue = buildDailyQueue(db, scheduler, settings.study, now)
  const window = dayWindow(now, dayStartHour)
  const logs = db
    .prepare(
      'SELECT card_id, outcome, duration_ms, state_before FROM review_logs WHERE reviewed_at >= ? ORDER BY reviewed_at'
    )
    .all(window.start) as {
    card_id: number
    outcome: string
    duration_ms: number
    state_before: number
  }[]
  const firstByCard = new Map<number, string>()
  for (const log of logs)
    if (!firstByCard.has(log.card_id)) firstByCard.set(log.card_id, log.outcome)
  const firstCorrect = [...firstByCard.values()].filter(
    (o) => o === 'correct' || o === 'known'
  ).length
  const words = db
    .prepare("SELECT COUNT(*) AS total, COALESCE(SUM(status = 'ready'), 0) AS ready FROM words")
    .get() as { total: number; ready: number }

  return {
    dueReviews: queue.reviews,
    learning: queue.learning,
    newAvailable: queue.newCards,
    reviewedToday: logs.length,
    newToday: new Set(logs.filter((l) => l.state_before === 0).map((l) => l.card_id)).size,
    accuracyToday: firstByCard.size > 0 ? firstCorrect / firstByCard.size : null,
    minutesToday: Math.round(logs.reduce((sum, l) => sum + l.duration_ms, 0) / 60_000),
    streak: computeStreak(db, dayStartHour, now),
    totalWords: words.total,
    readyWords: words.ready
  }
}

export function buildDashboard(
  db: DB,
  scheduler: FSRS,
  settings: AppSettings,
  now = Date.now()
): Dashboard {
  const { dayStartHour } = settings.study
  const offset = dayStartHour * HOUR
  const window = dayWindow(now, dayStartHour)

  // ---- daily activity, last 90 days ----
  const dailyKeys = recentDays(now, dayStartHour, 90)
  const dailyRows = db
    .prepare(
      `WITH l AS (
         SELECT state_before, outcome, duration_ms, ${sqlDay('reviewed_at')} AS day,
           ROW_NUMBER() OVER (PARTITION BY card_id, ${sqlDay('reviewed_at')} ORDER BY reviewed_at) AS nth
         FROM review_logs WHERE reviewed_at >= @since
       )
       SELECT day,
         SUM(state_before = 0) AS new_cards, SUM(state_before = 1) AS learning,
         SUM(state_before = 2) AS review, SUM(state_before = 3) AS relearning,
         SUM(nth = 1) AS first_attempts,
         SUM(nth = 1 AND outcome IN ('correct', 'known')) AS first_correct,
         SUM(duration_ms) AS duration
       FROM l GROUP BY day`
    )
    .all({ offset, since: window.start - 90 * DAY }) as {
    day: string
    new_cards: number
    learning: number
    review: number
    relearning: number
    first_attempts: number
    first_correct: number
    duration: number
  }[]
  const byDay = new Map(dailyRows.map((r) => [r.day, r]))
  const daily: DailyStat[] = dailyKeys.map((date) => {
    const r = byDay.get(date)
    return {
      date,
      newCards: r?.new_cards ?? 0,
      learning: r?.learning ?? 0,
      review: r?.review ?? 0,
      relearning: r?.relearning ?? 0,
      firstAttempts: r?.first_attempts ?? 0,
      firstCorrect: r?.first_correct ?? 0,
      minutes: Math.round(((r?.duration ?? 0) / 60_000) * 10) / 10
    }
  })

  // ---- calendar heatmap, last year ----
  const heatRows = db
    .prepare(
      `SELECT ${sqlDay('reviewed_at')} AS day, COUNT(*) AS n FROM review_logs WHERE reviewed_at >= @since GROUP BY day`
    )
    .all({ offset, since: window.start - 366 * DAY }) as { day: string; n: number }[]
  const heatByDay = new Map(heatRows.map((r) => [r.day, r.n]))
  const heatmap = recentDays(now, dayStartHour, 365).map((date) => ({
    date,
    count: heatByDay.get(date) ?? 0
  }))

  // ---- cards ----
  const cards = db
    .prepare("SELECT c.* FROM cards c JOIN words w ON w.id = c.word_id WHERE w.status = 'ready'")
    .all() as CardRow[]
  const states = { new: 0, learning: 0, relearning: 0, young: 0, mature: 0, suspended: 0 }
  const forecastKeys = recentDays(now + 29 * DAY, dayStartHour, 30)
  const forecastCounts = new Map(forecastKeys.map((k) => [k, 0]))
  const todayKey = dayKey(now, dayStartHour)
  const buckets = [
    { label: '<1天', max: 1 },
    { label: '1–7天', max: 7 },
    { label: '7–21天', max: 21 },
    { label: '21–90天', max: 90 },
    { label: '90–365天', max: 365 },
    { label: '>1年', max: Infinity }
  ].map((b) => ({ ...b, count: 0 }))
  let rSum = 0
  let rCount = 0

  for (const card of cards) {
    if (card.suspended) {
      states.suspended++
      continue
    }
    if (card.state === 0) states.new++
    else if (card.state === 1) states.learning++
    else if (card.state === 3) states.relearning++
    else if (card.stability >= MATURE_DAYS) states.mature++
    else states.young++

    if (card.state !== 0) {
      const key = card.due < window.start ? todayKey : dayKey(card.due, dayStartHour)
      if (forecastCounts.has(key)) forecastCounts.set(key, forecastCounts.get(key)! + 1)
    }
    if (card.state === 2 || card.state === 3) {
      buckets.find((b) => card.stability < b.max)!.count++
      const r = retrievability(scheduler, card, now)
      if (r !== null) {
        rSum += r
        rCount++
      }
    }
  }

  // ---- words ----
  const words = db
    .prepare(
      `SELECT COUNT(*) AS total,
         COALESCE(SUM(status = 'ready'), 0) AS ready,
         COALESCE(SUM(status IN ('pending', 'enriching')), 0) AS pending,
         COALESCE(SUM(status = 'failed'), 0) AS failed,
         COALESCE(SUM(EXISTS (SELECT 1 FROM cards c WHERE c.word_id = words.id AND c.reps > 0)), 0) AS studied,
         COALESCE(SUM(
           EXISTS (SELECT 1 FROM cards c WHERE c.word_id = words.id AND c.suspended = 0)
           AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.word_id = words.id AND c.suspended = 0
                           AND NOT (c.state = 2 AND c.stability >= ${MATURE_DAYS}))
         ), 0) AS fully_mature
       FROM words`
    )
    .get() as {
    total: number
    ready: number
    pending: number
    failed: number
    studied: number
    fully_mature: number
  }

  // ---- retention ----
  const retention = db
    .prepare(
      'SELECT COUNT(*) AS total, COALESCE(SUM(rating > 1), 0) AS passed FROM review_logs WHERE state_before = 2 AND reviewed_at >= ?'
    )
    .get(now - 30 * DAY) as { total: number; passed: number }

  const hardest = db
    .prepare(
      `SELECT w.id AS word_id, w.headword, SUM(c.lapses) AS lapses,
         (SELECT COUNT(*) FROM review_logs l WHERE l.word_id = w.id) AS reviews,
         (SELECT AVG(l.outcome IN ('correct', 'known')) FROM review_logs l WHERE l.word_id = w.id) AS accuracy
       FROM words w JOIN cards c ON c.word_id = w.id
       GROUP BY w.id HAVING reviews >= 3
       ORDER BY lapses DESC, accuracy ASC LIMIT 12`
    )
    .all() as {
    word_id: number
    headword: string
    lapses: number
    reviews: number
    accuracy: number
  }[]

  const leeches = db
    .prepare(
      `SELECT w.id AS word_id, w.headword, MAX(c.lapses) AS lapses FROM cards c JOIN words w ON w.id = c.word_id
       WHERE c.lapses >= 8 GROUP BY w.id ORDER BY lapses DESC LIMIT 30`
    )
    .all() as { word_id: number; headword: string; lapses: number }[]

  const llm = db
    .prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(ok = 0), 0) AS failed,
         COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
         COALESCE(SUM(cache_hit_tokens), 0) AS cache_hit_tokens
       FROM llm_calls`
    )
    .get() as {
    calls: number
    failed: number
    prompt_tokens: number
    completion_tokens: number
    cache_hit_tokens: number
  }

  return {
    today: todayOverview(db, scheduler, settings, now),
    states,
    words: {
      total: words.total,
      ready: words.ready,
      pending: words.pending,
      failed: words.failed,
      studied: words.studied,
      fullyMature: words.fully_mature
    },
    daily,
    heatmap,
    forecast: forecastKeys.map((date) => ({ date, count: forecastCounts.get(date) ?? 0 })),
    stabilityBuckets: buckets.map(({ label, count }) => ({ label, count })),
    retention: {
      target: settings.study.retention,
      last30Total: retention.total,
      last30Passed: retention.passed,
      avgRetrievability: rCount > 0 ? rSum / rCount : null
    },
    hardest: hardest.map((h) => ({
      wordId: h.word_id,
      headword: h.headword,
      lapses: h.lapses,
      reviews: h.reviews,
      accuracy: h.accuracy
    })),
    leeches: leeches.map((l) => ({ wordId: l.word_id, headword: l.headword, lapses: l.lapses })),
    lists: listSummaries(db),
    llm: {
      calls: llm.calls,
      failed: llm.failed,
      promptTokens: llm.prompt_tokens,
      completionTokens: llm.completion_tokens,
      cacheHitTokens: llm.cache_hit_tokens
    }
  }
}
