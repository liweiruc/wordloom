import { Rating, State, type FSRS, type IPreview, type RecordLogItem } from 'ts-fsrs'
import { judgeAnswer, suggestGrade } from '../../shared/answer'
import { clozeAnswer } from '../../shared/cloze'
import {
  GRADES,
  type AnswerRequest,
  type AnswerResult,
  type CardState,
  type Grade,
  type Outcome,
  type Register,
  type SessionSummary,
  type StudyCardContent,
  type StudyProgress,
  type StudySettings,
  type StudyStep
} from '../../shared/types'
import type { DB } from '../db/types'
import { parseCloze, parseSynonyms, parseVariants } from '../library/words'
import { dayWindow, type QueueEntry } from './queue'
import { formatInterval, fromFsrsCard, toFsrsCard, type CardRow } from './scheduler'

export interface SessionDeps {
  db: DB
  scheduler: FSRS
  settings: StudySettings
  now(): number
}

interface SessionItem extends QueueEntry {
  /** A new card shows its intro first; afterwards it is asked as a blank. */
  introduced: boolean
  /** Not served again before this many cards have been served in total. */
  holdUntil: number
}

interface AnswerFacts {
  outcome: Outcome
  suggested: Grade
  input: string
  hintsUsed: number
  durationMs: number
  at: number
}

interface Pending extends AnswerFacts {
  cardId: number
  before: CardRow
  preview: IPreview
}

interface UndoRecord {
  logId: number
  before: CardRow
  item: SessionItem
  requeued: boolean
  correct: boolean
  newLearned: boolean
  again: boolean
}

/** A learning card due within this window is shown early rather than ending the session. */
const LEARN_AHEAD_MS = 20 * 60_000
/** A new card comes back as a blank after this many other cards. */
const INTRO_GAP = 3

interface ContentRow {
  card_id: number
  word_id: number
  sense_id: number
  state: number
  headword: string
  ipa_uk: string
  ipa_us: string
  variants: string
  pos: string
  register: Register
  def_en: string
  def_zh: string
  synonyms: string
  en: string | null
  zh: string | null
  cloze: string | null
}

function loadContentRow(db: DB, cardId: number): ContentRow | undefined {
  return db
    .prepare(
      `SELECT c.id AS card_id, c.word_id, c.sense_id, c.state, w.headword, w.ipa_uk, w.ipa_us, w.variants,
         s.pos, s.register, s.def_en, s.def_zh, s.synonyms, e.en, e.zh, e.cloze
       FROM cards c
       JOIN senses s ON s.id = c.sense_id
       JOIN words w ON w.id = c.word_id
       LEFT JOIN examples e ON e.id = (SELECT id FROM examples WHERE sense_id = s.id ORDER BY ord LIMIT 1)
       WHERE c.id = ?`
    )
    .get(cardId) as ContentRow | undefined
}

export function loadCardContent(db: DB, cardId: number): StudyCardContent | null {
  const row = loadContentRow(db, cardId)
  if (!row) return null
  const others = db
    .prepare(
      'SELECT pos, def_en, def_zh, synonyms FROM senses WHERE word_id = ? AND id != ? ORDER BY ord'
    )
    .all(row.word_id, row.sense_id) as {
    pos: string
    def_en: string
    def_zh: string
    synonyms: string
  }[]
  const studiedSibling = db
    .prepare('SELECT 1 FROM cards WHERE word_id = ? AND id != ? AND reps > 0 LIMIT 1')
    .get(row.word_id, row.card_id)
  return {
    cardId: row.card_id,
    wordId: row.word_id,
    senseId: row.sense_id,
    headword: row.headword,
    ipaUk: row.ipa_uk,
    ipaUs: row.ipa_us,
    pos: row.pos,
    register: row.register,
    defEn: row.def_en,
    defZh: row.def_zh,
    synonyms: parseSynonyms(row.synonyms),
    example: { en: row.en ?? '', zh: row.zh ?? '', cloze: row.cloze ? parseCloze(row.cloze) : [] },
    otherSenses: others.map((o) => ({
      pos: o.pos,
      defEn: o.def_en,
      defZh: o.def_zh,
      synonyms: parseSynonyms(o.synonyms)
    })),
    state: row.state as CardState,
    firstSenseOfWord: !studiedSibling
  }
}

function loadCardRow(db: DB, cardId: number): CardRow {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as CardRow | undefined
  if (!row) throw new Error('这张卡已经不存在了。')
  return row
}

// One sitting of study. The queue for the day is fixed when the session starts; cards that
// land in a learning step (a new card, or a lapse) are put back and come up again when due.
// Every rating is written straight to the database, and the undo stack can walk any number
// of them back, restoring each card exactly as it was.
export class StudySession {
  private readonly queue: SessionItem[]
  private current: SessionItem | null = null
  private pending: Pending | null = null
  private readonly undoStack: UndoRecord[] = []
  private served = 0
  private readonly startedAt: number
  private readonly dayEnd: number
  private readonly stats = { reviewed: 0, correct: 0, newLearned: 0, again: 0 }
  private readonly trouble = new Map<number, { headword: string; count: number }>()

  constructor(
    private readonly deps: SessionDeps,
    entries: QueueEntry[]
  ) {
    this.queue = entries.map((e) => ({ ...e, introduced: e.kind !== 'new', holdUntil: 0 }))
    this.startedAt = deps.now()
    this.dayEnd = dayWindow(this.startedAt, deps.settings.dayStartHour).end
  }

  step(): StudyStep {
    for (;;) {
      if (!this.current) this.current = this.takeNext()
      if (!this.current) return { kind: 'done', summary: this.summary(), canUndo: this.canUndo() }
      const card = loadCardContent(this.deps.db, this.current.cardId)
      // Deleted while the session was open: skip it.
      if (!card) {
        this.current = null
        continue
      }
      const kind = this.current.kind === 'new' && !this.current.introduced ? 'intro' : 'cloze'
      return { kind, card, progress: this.progress(), canUndo: this.canUndo() }
    }
  }

  continueIntro(): StudyStep {
    const item = this.requireCurrent()
    if (item.introduced) return this.step()
    item.introduced = true
    item.holdUntil = this.served + INTRO_GAP
    this.queue.splice(Math.min(INTRO_GAP, this.queue.length), 0, item)
    this.current = null
    return this.step()
  }

  /** "I already know this": the new card is rated Easy without being asked. */
  markKnown(): StudyStep {
    const item = this.requireCurrent()
    const now = this.deps.now()
    const before = loadCardRow(this.deps.db, item.cardId)
    const preview = this.deps.scheduler.repeat(toFsrsCard(before), new Date(now))
    this.commit(item, before, preview[Rating.Easy], 4, {
      outcome: 'known',
      suggested: 4,
      input: '',
      hintsUsed: 0,
      durationMs: 0,
      at: now
    })
    return this.step()
  }

  answer(req: AnswerRequest): AnswerResult {
    const item = this.requireCurrent()
    if (req.cardId !== item.cardId) throw new Error('当前卡片已经变了，请重新作答。')
    const row = loadContentRow(this.deps.db, item.cardId)
    if (!row) throw new Error('这张卡已经不存在了。')
    const cloze = row.cloze ? parseCloze(row.cloze) : []
    const target = {
      cloze: cloze.length > 0 ? cloze : [row.headword],
      headword: row.headword,
      variants: parseVariants(row.variants)
    }
    const outcome: Outcome = req.gaveUp ? 'gave_up' : judgeAnswer(req.input, target)
    const suggested = suggestGrade(outcome, req.hintsUsed)
    const now = this.deps.now()
    const before = loadCardRow(this.deps.db, item.cardId)
    // The intervals shown on the buttons are the ones a rating will apply: rate() reuses
    // this preview instead of scheduling again (fuzz would otherwise pick a new interval).
    const preview = this.deps.scheduler.repeat(toFsrsCard(before), new Date(now))
    this.pending = {
      cardId: item.cardId,
      outcome,
      suggested,
      input: req.input,
      hintsUsed: req.hintsUsed,
      durationMs: Math.max(0, Math.round(req.durationMs)),
      at: now,
      before,
      preview
    }
    const intervals = {} as Record<Grade, string>
    for (const g of GRADES) intervals[g] = formatInterval(preview[g].card.due.getTime() - now)
    return { outcome, expected: clozeAnswer(target.cloze), suggested, intervals }
  }

  rate(grade: Grade): StudyStep {
    const item = this.requireCurrent()
    const pending = this.pending
    if (!pending || pending.cardId !== item.cardId) throw new Error('请先作答再评分。')
    this.commit(item, pending.before, pending.preview[grade], grade, pending)
    return this.step()
  }

  undo(): StudyStep {
    const record = this.undoStack.pop()
    if (!record) return this.step()
    const { db } = this.deps
    db.transaction(() => {
      const b = record.before
      db.prepare(
        `UPDATE cards SET due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
           learning_steps = ?, reps = ?, lapses = ?, state = ?, last_review = ? WHERE id = ?`
      ).run(
        b.due,
        b.stability,
        b.difficulty,
        b.elapsed_days,
        b.scheduled_days,
        b.learning_steps,
        b.reps,
        b.lapses,
        b.state,
        b.last_review,
        b.id
      )
      db.prepare('DELETE FROM review_logs WHERE id = ?').run(record.logId)
    })()
    if (record.requeued) {
      const at = this.queue.findIndex(
        (it) => it.cardId === record.item.cardId && it.kind === 'learning'
      )
      if (at >= 0) this.queue.splice(at, 1)
    }
    if (this.current) this.queue.unshift(this.current)
    this.current = record.item
    this.pending = null
    this.stats.reviewed--
    if (record.correct) this.stats.correct--
    if (record.newLearned) this.stats.newLearned--
    if (record.again) {
      this.stats.again--
      const t = this.trouble.get(record.item.wordId)
      if (t && --t.count <= 0) this.trouble.delete(record.item.wordId)
    }
    return this.step()
  }

  summary(): SessionSummary {
    return {
      ...this.stats,
      durationMs: this.deps.now() - this.startedAt,
      learningLater: this.queue.filter((it) => it.kind === 'learning').length,
      troubleWords: [...this.trouble.entries()].map(([wordId, t]) => ({
        wordId,
        headword: t.headword
      }))
    }
  }

  private canUndo(): boolean {
    return this.undoStack.length > 0
  }

  private progress(): StudyProgress {
    const items = this.current ? [this.current, ...this.queue] : this.queue
    return {
      done: this.stats.reviewed,
      remaining: items.length,
      newLeft: items.filter((it) => it.kind === 'new').length,
      reviewLeft: items.filter((it) => it.kind === 'review').length,
      learningLeft: items.filter((it) => it.kind === 'learning').length
    }
  }

  private requireCurrent(): SessionItem {
    if (!this.current) this.step()
    if (!this.current) throw new Error('今天的学习已经完成了。')
    return this.current
  }

  private takeNext(): SessionItem | null {
    const now = this.deps.now()
    // Reviews and new cards belong to the day, whatever hour FSRS put on them: a card due
    // at 20:00 is as studiable at 9:00. Only learning steps ("again in 10 minutes") wait.
    const ready = (it: SessionItem): boolean =>
      (it.kind !== 'learning' || it.due <= now) && it.holdUntil <= this.served
    // A learning card that has come due is time-critical: it goes before anything else.
    let index = -1
    this.queue.forEach((it, i) => {
      if (it.kind === 'learning' && ready(it) && (index < 0 || it.due < this.queue[index].due))
        index = i
    })
    if (index < 0) index = this.queue.findIndex(ready)
    if (index < 0) {
      // Nothing is ready: take whatever comes due soonest, as long as that is soon.
      this.queue.forEach((it, i) => {
        if (it.due - now > LEARN_AHEAD_MS) return
        if (index < 0 || it.due < this.queue[index].due) index = i
      })
    }
    if (index < 0) return null
    const [item] = this.queue.splice(index, 1)
    this.served++
    return item
  }

  private commit(
    item: SessionItem,
    before: CardRow,
    result: RecordLogItem,
    grade: Grade,
    facts: AnswerFacts
  ): void {
    const { db } = this.deps
    const after = fromFsrsCard(result.card)
    const logId = db.transaction(() => {
      db.prepare(
        `UPDATE cards SET due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
           learning_steps = ?, reps = ?, lapses = ?, state = ?, last_review = ? WHERE id = ?`
      ).run(
        after.due,
        after.stability,
        after.difficulty,
        after.elapsed_days,
        after.scheduled_days,
        after.learning_steps,
        after.reps,
        after.lapses,
        after.state,
        after.last_review,
        before.id
      )
      return Number(
        db
          .prepare(
            `INSERT INTO review_logs (card_id, word_id, reviewed_at, rating, suggested_rating, outcome, answer,
               hints_used, duration_ms, state_before, card_before, stability, difficulty, scheduled_days, elapsed_days)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            before.id,
            before.word_id,
            facts.at,
            grade,
            facts.suggested,
            facts.outcome,
            facts.input,
            facts.hintsUsed,
            facts.durationMs,
            before.state,
            JSON.stringify(before),
            after.stability,
            after.difficulty,
            after.scheduled_days,
            result.log.elapsed_days
          ).lastInsertRowid
      )
    })()

    const learningAgain = after.state === State.Learning || after.state === State.Relearning
    const requeued = learningAgain && after.due < this.dayEnd
    if (requeued) {
      this.queue.push({
        cardId: item.cardId,
        wordId: item.wordId,
        kind: 'learning',
        due: after.due,
        introduced: true,
        holdUntil: 0
      })
    }

    const correct = facts.outcome === 'correct' || facts.outcome === 'known'
    const newLearned = before.state === State.New
    const again = grade === 1
    this.stats.reviewed++
    if (correct) this.stats.correct++
    if (newLearned) this.stats.newLearned++
    if (again) {
      this.stats.again++
      const headword = (
        db.prepare('SELECT headword FROM words WHERE id = ?').get(item.wordId) as
          { headword: string } | undefined
      )?.headword
      const t = this.trouble.get(item.wordId)
      if (t) t.count++
      else this.trouble.set(item.wordId, { headword: headword ?? '', count: 1 })
    }
    this.undoStack.push({ logId, before, item: { ...item }, requeued, correct, newLearned, again })
    this.pending = null
    this.current = null
  }
}
