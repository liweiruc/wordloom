const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  return `${formatDate(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** When a card is next due, relative to now: "已到期", "20分钟后", "明天", "5天后". */
export function formatDue(due: number, now = Date.now()): string {
  const diff = due - now
  if (diff <= 0) return '已到期'
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MIN))}分钟后`
  if (diff < DAY) return `${Math.round(diff / HOUR)}小时后`
  const days = Math.round(diff / DAY)
  if (days === 1) return '明天'
  if (days < 60) return `${days}天后`
  if (days < 730) return `${Math.round(days / 30)}个月后`
  return `${Math.round(days / 365)}年后`
}

export function formatDays(days: number): string {
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}小时`
  if (days < 60) return `${Math.round(days * 10) / 10}天`
  if (days < 730) return `${Math.round(days / 3) / 10}个月`
  return `${Math.round(days / 36.5) / 10}年`
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / MIN)
  if (ms <= 0) return '0分钟'
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))}秒`
  if (minutes < 60) return `${minutes}分钟`
  return `${Math.floor(minutes / 60)}小时${minutes % 60 ? `${minutes % 60}分钟` : ''}`
}

export function percent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '—'
  return `${(ratio * 100).toFixed(digits)}%`
}

/** 1,284 · 12.9K · 3.4M: compact from ten thousand up. */
export function compact(n: number): string {
  if (Math.abs(n) < 10_000) return n.toLocaleString('en-US')
  if (Math.abs(n) < 1_000_000) return `${Math.round(n / 100) / 10}K`
  return `${Math.round(n / 100_000) / 10}M`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
