import type { AppSettings, SettingsPatch } from '../../shared/types'
import type { DB } from './types'

export const DEFAULT_SETTINGS: AppSettings = {
  llm: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    batchSize: 8,
    concurrency: 5,
    maxSenses: 4,
    smartCleanup: true
  },
  study: {
    newPerDay: 20,
    reviewsPerDay: 200,
    retention: 0.9,
    learningSteps: ['1m', '10m'],
    relearningSteps: ['10m'],
    maxIntervalDays: 36500,
    dayStartHour: 4,
    newOrder: 'primary-first'
  },
  display: {
    chineseDisplay: 'tap',
    autoSpeak: true,
    voice: '',
    speechRate: 0.9
  },
  data: {
    backupKeep: 14
  }
}

const SETTINGS_KEY = 'app'
const API_KEY_KEY = 'secret.llmApiKey'

/** Turns the API key into something safe to keep on disk and back again. */
export interface SecretCodec {
  encrypt(plain: string): string
  decrypt(stored: string): string
}

function readRow(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value ?? null
}

function writeRow(db: DB, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

// Stored settings are merged section by section over the defaults, so a setting added in a
// later version simply takes its default on databases saved before it existed.
function mergeSettings(base: AppSettings, patch: SettingsPatch): AppSettings {
  return {
    llm: { ...base.llm, ...patch.llm },
    study: { ...base.study, ...patch.study },
    display: { ...base.display, ...patch.display },
    data: { ...base.data, ...patch.data }
  }
}

export function loadSettings(db: DB): AppSettings {
  const raw = readRow(db, SETTINGS_KEY)
  if (!raw) return DEFAULT_SETTINGS
  try {
    return mergeSettings(DEFAULT_SETTINGS, JSON.parse(raw) as SettingsPatch)
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(db: DB, patch: SettingsPatch): AppSettings {
  const next = mergeSettings(loadSettings(db), patch)
  writeRow(db, SETTINGS_KEY, JSON.stringify(next))
  return next
}

export function hasApiKey(db: DB): boolean {
  return readRow(db, API_KEY_KEY) !== null
}

export function loadApiKey(db: DB, codec: SecretCodec): string | null {
  const stored = readRow(db, API_KEY_KEY)
  if (!stored) return null
  try {
    return codec.decrypt(stored)
  } catch {
    return null
  }
}

export function saveApiKey(db: DB, codec: SecretCodec, key: string): void {
  const trimmed = key.trim()
  if (!trimmed) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(API_KEY_KEY)
    return
  }
  writeRow(db, API_KEY_KEY, codec.encrypt(trimmed))
}
