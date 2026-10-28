import { fsrs, generatorParameters, State, type Card, type FSRS, type StepUnit } from 'ts-fsrs'
import type { CardState, CardView, StudySettings } from '../../shared/types'

/** A `cards` row as better-sqlite3 returns it. */
export interface CardRow {
  id: number
  sense_id: number
  word_id: number
  due: number
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: number
  last_review: number | null
  suspended: number
  new_rank: number
  created_at: number
}

export type FsrsFields = Pick<
  CardRow,
  | 'due'
  | 'stability'
  | 'difficulty'
  | 'elapsed_days'
  | 'scheduled_days'
  | 'learning_steps'
  | 'reps'
  | 'lapses'
  | 'state'
  | 'last_review'
>

const STEP_RE = /^\d+(?:\.\d+)?[mhd]$/

function steps(values: string[], fallback: StepUnit[]): StepUnit[] {
  // An empty list is a real choice (FSRS schedules from the first answer); garbage is not.
  if (values.length === 0) return []
  const valid = values.map((v) => v.trim()).filter((v) => STEP_RE.test(v)) as StepUnit[]
  return valid.length > 0 ? valid : fallback
}

export function makeScheduler(study: StudySettings): FSRS {
  return fsrs(
    generatorParameters({
      request_retention: Math.min(0.99, Math.max(0.7, study.retention)),
      maximum_interval: Math.max(1, Math.round(study.maxIntervalDays)),
      // Spreads cards that would all fall due on the same day.
      enable_fuzz: true,
      enable_short_term: true,
      learning_steps: steps(study.learningSteps, ['1m', '10m']),
      relearning_steps: steps(study.relearningSteps, ['10m'])
    })
  )
}

export function toFsrsCard(row: FsrsFields): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.last_review == null ? undefined : new Date(row.last_review)
  }
}

export function fromFsrsCard(card: Card): FsrsFields {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.getTime() : null
  }
}

/** Predicted chance of recalling the card now, from its own forgetting curve. */
export function retrievability(scheduler: FSRS, row: FsrsFields, now: number): number | null {
  if (row.state === State.New || row.last_review == null || row.stability <= 0) return null
  return scheduler.get_retrievability(toFsrsCard(row), new Date(now), false)
}

export function toCardView(scheduler: FSRS, row: CardRow, now: number): CardView {
  return {
    id: row.id,
    state: row.state as CardState,
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    reps: row.reps,
    lapses: row.lapses,
    lastReview: row.last_review,
    suspended: row.suspended === 1,
    retrievability: retrievability(scheduler, row, now)
  }
}

export function formatInterval(ms: number): string {
  const minutes = ms / 60_000
  if (minutes < 1) return '<1分钟'
  if (minutes < 60) return `${Math.round(minutes)}分钟`
  const hours = minutes / 60
  if (hours < 24) return `${Math.round(hours)}小时`
  const days = hours / 24
  if (days < 30) return `${Math.round(days)}天`
  if (days < 365) return `${Math.round((days / 30) * 10) / 10}个月`
  return `${Math.round((days / 365) * 10) / 10}年`
}
