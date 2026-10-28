import type { FSRS } from 'ts-fsrs'
import { EVENT_CHANNELS, type WordloomApi } from '../shared/api'
import type { AppSettings, BackupInfo, SettingsView, StorageInfo } from '../shared/types'
import type { DB } from './db/types'
import { loadSettings, saveSettings } from './db/settings'
import { autoBackup, checkDatabaseFile } from './data/backup'
import { exportCsv, exportJson } from './data/export'
import { commitImport } from './import/commit'
import { buildPreview } from './import/preview'
import {
  deleteSense,
  getWordDetail,
  listSummaries,
  listWords,
  queueRegenerate,
  removeList,
  removeWord,
  renameList,
  setSuspended,
  updateSense,
  updateWord
} from './library/words'
import { LlmClient } from './llm/client'
import { EnrichQueue } from './llm/enrichQueue'
import { triageWords } from './llm/triage'
import { recordLlmCall } from './llm/usage'
import {
  addToDefaultList,
  lookupHistory,
  lookupWord,
  regenerateLookup,
  removeLookup,
  type LookupDeps
} from './lookup/lookup'
import { buildDailyQueue } from './srs/queue'
import { makeScheduler } from './srs/scheduler'
import { StudySession } from './srs/session'
import { cardCurve } from './stats/curve'
import { buildDashboard, todayOverview } from './stats/dashboard'

// The pieces that differ between the Windows app (Electron, src/main/index.ts) and the iPad
// web app (a Web Worker, src/web/worker.ts), kept behind interfaces so this file serves both.

/** Messages to the window, and restarting. */
export interface Platform {
  send(channel: string, payload: unknown): void
  /** Restarts the app; used after a restore replaced the database file. */
  relaunch(): void
}

/** Where the database file lives and how copies of it are made. */
export interface DataStore {
  readonly info: StorageInfo
  /** Shows the data folder in the system's file manager, where there is one. */
  openFolder?(): Promise<void>
  /** Newest first. */
  listBackups(): Promise<BackupInfo[]>
  /** Copies the open database into the backups; regular ones beyond `keep` are pruned. */
  backup(keep: number, prefix?: string): Promise<BackupInfo>
  readBackup(file: string): Promise<Uint8Array>
  /** The open database as a single file. */
  snapshot(): Promise<Uint8Array>
  /** Overwrites the database file. The connection is closed first, and the app relaunches after. */
  replace(bytes: Uint8Array): Promise<void>
}

/** Keeps the LLM API key: encrypted in the database on Windows, outside it on the iPad. */
export interface SecretStore {
  has(): boolean
  load(): string | null
  save(key: string): void | Promise<void>
}

export interface ServiceDeps {
  db: DB
  store: DataStore
  secrets: SecretStore
  platform: Platform
}

function exportName(extension: string): string {
  return `wordloom-${new Date().toISOString().slice(0, 10)}.${extension}`
}

export function createServices(deps: ServiceDeps): {
  api: WordloomApi
  start(): Promise<void>
  shutdown(): void
} {
  const { db, store, secrets, platform } = deps

  let settings: AppSettings = loadSettings(db)
  let scheduler: FSRS = makeScheduler(settings.study)
  let client: LlmClient | null = null
  let clientKey = ''
  let session: StudySession | null = null

  function getClient(): LlmClient | null {
    const apiKey = secrets.load()
    if (!apiKey) return null
    const key = `${apiKey}\n${settings.llm.baseUrl}\n${settings.llm.model}`
    if (!client || key !== clientKey) {
      client = new LlmClient({ apiKey, baseUrl: settings.llm.baseUrl, model: settings.llm.model })
      clientKey = key
    }
    return client
  }

  function requireClient(): LlmClient {
    const c = getClient()
    if (!c) throw new Error('还没有设置 DeepSeek API key，请先到「设置」里填写。')
    return c
  }

  const queue = new EnrichQueue({
    db,
    getClient,
    getSettings: () => settings,
    onStatus: (status) => platform.send(EVENT_CHANNELS.enrichStatus, status)
  })

  function view(): SettingsView {
    return { settings, hasApiKey: secrets.has(), storage: store.info }
  }

  // Replaces the whole database and restarts. The current state is kept as a backup too, in
  // case the restore was a mistake.
  async function restoreFrom(bytes: Uint8Array): Promise<void> {
    checkDatabaseFile(bytes)
    await store.backup(settings.data.backupKeep, 'pre-restore-')
    queue.pause()
    db.close()
    await store.replace(bytes)
    platform.relaunch()
  }

  function requireSession(): StudySession {
    if (!session) throw new Error('学习会话已结束，请重新开始。')
    return session
  }

  function lookupDeps(): LookupDeps {
    return { db, scheduler, settings, requireClient, record: (call) => recordLlmCall(db, call) }
  }

  const api: WordloomApi = {
    settings: {
      async get() {
        return view()
      },
      async update(patch) {
        settings = saveSettings(db, patch)
        if (patch.study) {
          scheduler = makeScheduler(settings.study)
          // The open session keeps the scheduler it started with; a new one picks this up.
        }
        return view()
      },
      async setApiKey(key) {
        await secrets.save(key)
        client = null
        if (key.trim()) queue.resume()
        return view()
      },
      async testConnection() {
        const c = getClient()
        if (!c) return { ok: false, message: '还没有填写 API key。' }
        return c.check()
      }
    },

    importer: {
      async parse(sources, format) {
        return buildPreview(db, sources, format)
      },
      async triage(words) {
        return triageWords(
          { client: requireClient(), record: (call) => recordLlmCall(db, call) },
          words,
          (done, total) => platform.send(EVENT_CHANNELS.triageProgress, { done, total })
        )
      },
      async commit(req) {
        const result = commitImport(db, req)
        queue.kick()
        return result
      }
    },

    enrich: {
      async status() {
        return queue.status()
      },
      async resume() {
        queue.resume()
        return queue.status()
      },
      async pause() {
        queue.pause()
        return queue.status()
      },
      async retryFailed() {
        queue.retryFailed()
        return queue.status()
      }
    },

    words: {
      async list(query) {
        return listWords(db, query)
      },
      async get(id) {
        return getWordDetail(db, scheduler, id)
      },
      async update(id, patch) {
        updateWord(db, id, patch)
        return getWordDetail(db, scheduler, id)
      },
      async updateSense(senseId, patch) {
        const wordId = updateSense(db, senseId, patch)
        return getWordDetail(db, scheduler, wordId)
      },
      async deleteSense(senseId) {
        const wordId = deleteSense(db, senseId)
        return getWordDetail(db, scheduler, wordId)
      },
      async regenerate(id) {
        queueRegenerate(db, id)
        queue.kick()
        return getWordDetail(db, scheduler, id)
      },
      async remove(id) {
        removeWord(db, id)
      },
      async setSuspended(cardId, suspended) {
        const wordId = setSuspended(db, cardId, suspended)
        return getWordDetail(db, scheduler, wordId)
      },
      async curve(cardId) {
        return cardCurve(db, scheduler, cardId, settings.study.retention)
      }
    },

    lists: {
      async all() {
        return listSummaries(db)
      },
      async rename(id, name) {
        renameList(db, id, name)
      },
      async remove(id) {
        removeList(db, id)
      }
    },

    lookup: {
      async search(query, asTyped) {
        return lookupWord(lookupDeps(), query, asTyped)
      },
      async regenerate(headword) {
        return regenerateLookup(lookupDeps(), headword)
      },
      async add(headword) {
        return addToDefaultList(lookupDeps(), headword)
      },
      async history() {
        return lookupHistory(db)
      },
      async remove(id) {
        removeLookup(db, id)
      }
    },

    study: {
      async overview() {
        return todayOverview(db, scheduler, settings)
      },
      async start() {
        const now = Date.now()
        const daily = buildDailyQueue(db, scheduler, settings.study, now)
        session = new StudySession(
          { db, scheduler, settings: settings.study, now: () => Date.now() },
          daily.entries
        )
        return session.step()
      },
      async current() {
        return session ? session.step() : null
      },
      async continueIntro() {
        return requireSession().continueIntro()
      },
      async markKnown() {
        return requireSession().markKnown()
      },
      async answer(req) {
        return requireSession().answer(req)
      },
      async rate(grade) {
        return requireSession().rate(grade)
      },
      async undo() {
        return requireSession().undo()
      },
      async finish() {
        const summary = session?.summary() ?? null
        session = null
        return summary
      }
    },

    stats: {
      async dashboard() {
        return buildDashboard(db, scheduler, settings)
      }
    },

    data: {
      async openFolder() {
        await store.openFolder?.()
      },
      async backupNow() {
        return store.backup(settings.data.backupKeep)
      },
      async listBackups() {
        return store.listBackups()
      },
      async restore(file) {
        await restoreFrom(await store.readBackup(file))
      },
      async restoreFile(bytes) {
        await restoreFrom(bytes)
      },
      async exportDatabase() {
        return {
          name: exportName('db'),
          mime: 'application/vnd.sqlite3',
          data: await store.snapshot()
        }
      },
      async exportJson() {
        return { name: exportName('json'), mime: 'application/json', data: exportJson(db) }
      },
      async exportCsv() {
        return { name: exportName('csv'), mime: 'text/csv', data: exportCsv(db) }
      }
    }
  }

  return {
    api,
    async start() {
      queue.recover()
      queue.kick()
      try {
        await autoBackup(store, settings.data.backupKeep)
      } catch (err) {
        console.error('[backup] automatic backup failed:', err)
      }
    },
    shutdown() {
      queue.pause()
      if (db.open) db.close()
    }
  }
}
