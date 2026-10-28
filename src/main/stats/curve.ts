import type { FSRS } from 'ts-fsrs'
import type { CurveData, Grade } from '../../shared/types'
import type { DB } from '../db/types'
import type { CardRow } from '../srs/scheduler'

const DAY = 86_400_000
const POINTS = 40

// The card's forgetting curve as a saw-tooth: after each review recall decays from 100%
// along R(t) = forgetting_curve(t, S), with the stability S that review left behind, until
// the next review resets it. The last segment runs on past today to show what lies ahead.
export function cardCurve(
  db: DB,
  scheduler: FSRS,
  cardId: number,
  retention: number,
  now = Date.now()
): CurveData {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as CardRow | undefined
  if (!card) throw new Error('这张卡已经不存在了。')
  const logs = db
    .prepare(
      'SELECT reviewed_at, rating, stability FROM review_logs WHERE card_id = ? ORDER BY reviewed_at'
    )
    .all(cardId) as { reviewed_at: number; rating: Grade; stability: number }[]

  const segments: { t: number; r: number }[][] = []
  logs.forEach((log, i) => {
    const from = log.reviewed_at
    const next = logs[i + 1]?.reviewed_at
    const until = next ?? Math.max(now, card.due) + Math.max(7 * DAY, (card.due - from) * 0.5)
    const stability = Math.max(log.stability, 0.01)
    const points: { t: number; r: number }[] = []
    for (let k = 0; k <= POINTS; k++) {
      const t = from + ((until - from) * k) / POINTS
      points.push({ t, r: scheduler.forgetting_curve((t - from) / DAY, stability) })
    }
    segments.push(points)
  })

  return {
    cardId,
    now,
    retention,
    segments,
    reviews: logs.map((l) => ({ t: l.reviewed_at, rating: l.rating }))
  }
}
