import { describe, expect, it } from 'vitest'
import { openDatabase, type DB } from '../src/main/db/connection'
import { DEFAULT_SETTINGS } from '../src/main/db/settings'
import { commitImport } from '../src/main/import/commit'
import { saveEnrichment } from '../src/main/library/words'
import type { SenseDraft } from '../src/main/llm/validate'
import { buildDailyQueue, dayWindow, interleave } from '../src/main/srs/queue'
import { makeScheduler } from '../src/main/srs/scheduler'
import { StudySession } from '../src/main/srs/session'
import { cardCurve } from '../src/main/stats/curve'
import { buildDashboard, dayKey, todayOverview } from '../src/main/stats/dashboard'
import type { StudySettings } from '../src/shared/types'

const T0 = new Date(2026, 9, 25, 10, 0, 0).getTime()
const MIN = 60_000
const DAY = 86_400_000

function draft(headword: string, defs: string[]): SenseDraft[] {
  return defs.map((def, i) => ({
    pos: 'n.',
    defEn: def,
    defZh: '释义',
    synonyms: [],
    register: 'neutral',
    exampleEn: `Here is the ${headword} number ${i + 1}.`,
    exampleZh: '例句',
    cloze: [headword]
  }))
}

function seed(db: DB, words: Record<string, number>): Record<string, number> {
  commitImport(
    db,
    {
      listName: 'l',
      sourceFile: null,
      items: Object.keys(words).map((headword) => ({ headword }))
    },
    T0
  )
  const ids: Record<string, number> = {}
  for (const [headword, senses] of Object.entries(words)) {
    const { id } = db.prepare('SELECT id FROM words WHERE norm = ?').get(headword) as { id: number }
    ids[headword] = id
    saveEnrichment(
      db,
      id,
      {
        headword,
        ipaUk: '/x/',
        ipaUs: '/x/',
        variants: [],
        senses: draft(
          headword,
          Array.from({ length: senses }, (_, i) => `meaning ${i} of something`)
        )
      },
      { model: 'm', promptVersion: 1, maxSenses: 4, now: T0 }
    )
  }
  return ids
}

const study: StudySettings = { ...DEFAULT_SETTINGS.study }

describe('dayWindow', () => {
  it('starts the study day at the configured hour', () => {
    const early = new Date(2026, 9, 25, 3, 0).getTime()
    expect(dayWindow(early, 4).start).toBe(new Date(2026, 9, 24, 4, 0).getTime())
    const late = new Date(2026, 9, 25, 5, 0).getTime()
    expect(dayWindow(late, 4)).toEqual({
      start: new Date(2026, 9, 25, 4, 0).getTime(),
      end: new Date(2026, 9, 26, 4, 0).getTime()
    })
    expect(dayKey(early, 4)).toBe('2026-10-24')
    expect(dayKey(late, 4)).toBe('2026-10-25')
  })
})

describe('interleave', () => {
  it('spreads new cards between reviews', () => {
    expect(interleave(['r1', 'r2', 'r3', 'r4'], ['n1'])).toEqual(['r1', 'r2', 'n1', 'r3', 'r4'])
    expect(interleave([], ['n1', 'n2'])).toEqual(['n1', 'n2'])
  })
})

describe('buildDailyQueue', () => {
  it('introduces at most one sense of a word per day, main senses first', () => {
    const db = openDatabase(':memory:')
    seed(db, { alpha: 2, beta: 1, gamma: 3 })
    const q = buildDailyQueue(db, makeScheduler(study), study, T0)
    expect(q.newCards).toBe(3)
    const ords = q.entries.map(
      (e) =>
        (
          db
            .prepare('SELECT s.ord FROM cards c JOIN senses s ON s.id = c.sense_id WHERE c.id = ?')
            .get(e.cardId) as { ord: number }
        ).ord
    )
    expect(ords).toEqual([0, 0, 0])
    expect(new Set(q.entries.map((e) => e.wordId)).size).toBe(3)
  })

  it('respects the daily limits and keeps due siblings apart', () => {
    const db = openDatabase(':memory:')
    const ids = seed(db, { alpha: 2, beta: 1 })
    // Both senses of alpha and beta's only sense are reviews due today.
    db.prepare('UPDATE cards SET state = 2, stability = 5, last_review = ?, due = ?').run(
      T0 - 5 * DAY,
      T0 - MIN
    )
    const q = buildDailyQueue(db, makeScheduler(study), study, T0)
    expect(q.reviews).toBe(2)
    expect(q.entries.filter((e) => e.wordId === ids.alpha)).toHaveLength(1)
    const capped = buildDailyQueue(db, makeScheduler(study), { ...study, reviewsPerDay: 1 }, T0)
    expect(capped.reviews).toBe(1)
  })
})

describe('StudySession', () => {
  function session(db: DB, clock: { now: number }): StudySession {
    const scheduler = makeScheduler(study)
    const q = buildDailyQueue(db, scheduler, study, clock.now)
    return new StudySession({ db, scheduler, settings: study, now: () => clock.now }, q.entries)
  }

  it('walks a new card through intro, blank, learning step and graduation', () => {
    const db = openDatabase(':memory:')
    seed(db, { wiggle: 1 })
    const clock = { now: T0 }
    const s = session(db, clock)

    const intro = s.step()
    expect(intro.kind).toBe('intro')
    const cloze = s.continueIntro()
    expect(cloze.kind).toBe('cloze')
    if (cloze.kind !== 'cloze') return
    expect(cloze.card.firstSenseOfWord).toBe(true)

    clock.now += 20_000
    const result = s.answer({
      cardId: cloze.card.cardId,
      input: 'Wiggle',
      hintsUsed: 0,
      durationMs: 4000,
      gaveUp: false
    })
    expect(result).toMatchObject({ outcome: 'correct', expected: 'wiggle', suggested: 3 })
    expect(result.intervals[3]).toBe('10分钟')

    // Good on a new card: the 10-minute learning step, shown early as nothing else is left.
    const again = s.rate(3)
    expect(again.kind).toBe('cloze')
    const learning = db.prepare('SELECT state, due FROM cards').get() as {
      state: number
      due: number
    }
    expect(learning.state).toBe(1)
    expect(learning.due).toBe(clock.now + 10 * MIN)

    clock.now += 10 * MIN
    s.answer({
      cardId: cloze.card.cardId,
      input: 'wiggle',
      hintsUsed: 0,
      durationMs: 3000,
      gaveUp: false
    })
    const done = s.rate(3)
    expect(done.kind).toBe('done')
    if (done.kind !== 'done') return
    expect(done.summary).toMatchObject({ reviewed: 2, correct: 2, newLearned: 1, again: 0 })
    const graduated = db.prepare('SELECT state, reps FROM cards').get()
    expect(graduated).toEqual({ state: 2, reps: 2 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM review_logs').get()).toEqual({ n: 2 })
  })

  it('undoes ratings back to the exact previous card', () => {
    const db = openDatabase(':memory:')
    seed(db, { wiggle: 1 })
    const clock = { now: T0 }
    const s = session(db, clock)
    s.continueIntro()
    const before = db.prepare('SELECT * FROM cards').get()
    const step = s.step()
    if (step.kind !== 'cloze') throw new Error('expected a blank')
    s.answer({
      cardId: step.card.cardId,
      input: 'nope',
      hintsUsed: 0,
      durationMs: 1000,
      gaveUp: false
    })
    s.rate(1)
    expect(db.prepare('SELECT COUNT(*) AS n FROM review_logs').get()).toEqual({ n: 1 })
    const undone = s.undo()
    expect(undone.kind).toBe('cloze')
    expect(undone.canUndo).toBe(false)
    expect(db.prepare('SELECT * FROM cards').get()).toEqual(before)
    expect(db.prepare('SELECT COUNT(*) AS n FROM review_logs').get()).toEqual({ n: 0 })
  })

  it('counts a wrong answer as a lapse to see again and lists the word', () => {
    const db = openDatabase(':memory:')
    seed(db, { wiggle: 1 })
    const clock = { now: T0 }
    const s = session(db, clock)
    s.continueIntro()
    const step = s.step()
    if (step.kind !== 'cloze') throw new Error('expected a blank')
    const result = s.answer({
      cardId: step.card.cardId,
      input: '',
      hintsUsed: 0,
      durationMs: 1000,
      gaveUp: true
    })
    expect(result).toMatchObject({ outcome: 'gave_up', suggested: 1 })
    const next = s.rate(1)
    // Again on a new card is a 1-minute step: within the learn-ahead window, so it is next.
    expect(next.kind).toBe('cloze')
    expect(s.summary().troubleWords).toEqual([{ wordId: step.card.wordId, headword: 'wiggle' }])
  })

  it('serves a review due later today right away', () => {
    const db = openDatabase(':memory:')
    seed(db, { wiggle: 1 })
    // Reviewed yesterday evening, so FSRS put the due time at 20:00 today.
    const evening = new Date(2026, 9, 25, 20, 0).getTime()
    db.prepare('UPDATE cards SET state = 2, stability = 1, reps = 2, last_review = ?, due = ?').run(
      evening - DAY,
      evening
    )
    const step = session(db, { now: T0 }).step()
    expect(step.kind).toBe('cloze')
  })

  it('marks a known word Easy straight from the intro', () => {
    const db = openDatabase(':memory:')
    seed(db, { wiggle: 1 })
    const s = session(db, { now: T0 })
    expect(s.markKnown().kind).toBe('done')
    const card = db.prepare('SELECT state, due FROM cards').get() as { state: number; due: number }
    expect(card.state).toBe(2)
    expect(card.due - T0).toBeGreaterThan(5 * DAY)
    expect(db.prepare('SELECT outcome, rating FROM review_logs').get()).toEqual({
      outcome: 'known',
      rating: 4
    })
  })
})

describe('statistics', () => {
  it('reports today, the streak, history, the forecast and the curve', () => {
    const db = openDatabase(':memory:')
    seed(db, { wiggle: 1, tile: 2 })
    const clock = { now: T0 }
    const scheduler = makeScheduler(study)
    const q = buildDailyQueue(db, scheduler, study, clock.now)
    const s = new StudySession({ db, scheduler, settings: study, now: () => clock.now }, q.entries)
    for (let step = s.step(); step.kind !== 'done'; step = s.step()) {
      if (step.kind === 'intro') {
        s.continueIntro()
        continue
      }
      clock.now += MIN
      s.answer({
        cardId: step.card.cardId,
        input: step.card.example.cloze.join(' '),
        hintsUsed: 0,
        durationMs: 60_000,
        gaveUp: false
      })
      s.rate(3)
      clock.now += 10 * MIN
    }

    const settings = { ...DEFAULT_SETTINGS, study }
    const today = todayOverview(db, scheduler, settings, clock.now)
    expect(today).toMatchObject({
      reviewedToday: 4,
      newToday: 2,
      accuracyToday: 1,
      streak: 1,
      totalWords: 2,
      readyWords: 2
    })
    expect(today.minutesToday).toBe(4)

    const dash = buildDashboard(db, scheduler, settings, clock.now)
    expect(dash.daily).toHaveLength(90)
    expect(dash.daily.at(-1)).toMatchObject({
      newCards: 2,
      learning: 2,
      firstAttempts: 2,
      firstCorrect: 2
    })
    expect(dash.heatmap.at(-1)?.count).toBe(4)
    expect(dash.states).toMatchObject({ new: 1, young: 2 })
    expect(dash.forecast.reduce((n, d) => n + d.count, 0)).toBe(2)
    expect(dash.words).toMatchObject({ total: 2, ready: 2, studied: 2 })
    expect(dash.lists[0]).toMatchObject({ words: 2, cards: 3, studiedCards: 2 })

    const cardId = (
      db.prepare('SELECT card_id FROM review_logs LIMIT 1').get() as { card_id: number }
    ).card_id
    const curve = cardCurve(db, scheduler, cardId, study.retention, clock.now)
    expect(curve.segments).toHaveLength(2)
    expect(curve.segments[1][0].r).toBeCloseTo(1, 5)
    expect(curve.segments[1].at(-1)!.r).toBeLessThan(1)
  })
})
