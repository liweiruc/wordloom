import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import type { FSRS } from 'ts-fsrs'
import { EVENT_CHANNELS, type WordloomApi } from '../shared/api'
import type { AppSettings, ImportSource, SettingsView } from '../shared/types'
import type { DB } from './db/connection'
import {
  hasApiKey,
  loadApiKey,
  loadSettings,
  saveApiKey,
  saveSettings,
  type SecretCodec
} from './db/settings'
import { autoBackup, backupDatabase, listBackups } from './data/backup'
import { exportCsv, exportJson } from './data/export'
import { commitImport } from './import/commit'
import { decodeText } from './import/decode'
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

/** The Electron pieces the services need, kept behind functions so this file stays testable. */
export interface Platform {
  pickFiles(): Promise<string[]>
  pickSaveFile(
    defaultName: string,
    filters: { name: string; extensions: string[] }[]
  ): Promise<string | null>
  openPath(path: string): Promise<void>
  send(channel: string, payload: unknown): void
  /** Restarts the app; used after a restore replaced the database file. */
  relaunch(): void
}

export interface ServiceDeps {
  db: DB
  dbFile: string
  dataDir: string
  codec: SecretCodec
  platform: Platform
}

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.tsv', '.text'])

function readSource(path: string): ImportSource {
  const { text, encoding } = decodeText(readFileSync(path))
  return { name: basename(path), text, encoding }
}

export function createServices(deps: ServiceDeps): {
  api: WordloomApi
  start(): Promise<void>
  shutdown(): void
} {
  const { db, platform } = deps
  const backupDir = join(deps.dataDir, 'backups')

  let settings: AppSettings = loadSettings(db)
  let scheduler: FSRS = makeScheduler(settings.study)
  let client: LlmClient | null = null
  let clientKey = ''
  let session: StudySession | null = null

  function getClient(): LlmClient | null {
    const apiKey = loadApiKey(db, deps.codec)
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
    return { settings, hasApiKey: hasApiKey(db), dataDir: deps.dataDir }
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
        saveApiKey(db, deps.codec, key)
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
      async pickFiles() {
        const paths = await platform.pickFiles()
        return paths.map(readSource)
      },
      async readPaths(paths) {
        const usable = paths.filter(
          (p) => TEXT_EXTENSIONS.has(extname(p).toLowerCase()) && existsSync(p)
        )
        if (usable.length === 0) throw new Error('只支持 .txt / .md / .csv 文本文件。')
        return usable.map(readSource)
      },
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
        await platform.openPath(deps.dataDir)
      },
      async backupNow() {
        return backupDatabase(db, backupDir, settings.data.backupKeep)
      },
      async listBackups() {
        return listBackups(backupDir)
      },
      async restore(file) {
        if (!existsSync(file)) throw new Error('备份文件不存在。')
        // The current state is kept too, in case the restore was a mistake.
        await backupDatabase(db, backupDir, settings.data.backupKeep, 'pre-restore-')
        queue.pause()
        db.close()
        for (const suffix of ['-wal', '-shm']) rmSync(deps.dbFile + suffix, { force: true })
        copyFileSync(file, deps.dbFile)
        platform.relaunch()
      },
      async exportJson() {
        const target = await platform.pickSaveFile(
          `wordloom-${new Date().toISOString().slice(0, 10)}.json`,
          [{ name: 'JSON', extensions: ['json'] }]
        )
        if (!target) return null
        writeFileSync(target, exportJson(db), 'utf8')
        return target
      },
      async exportCsv() {
        const target = await platform.pickSaveFile(
          `wordloom-${new Date().toISOString().slice(0, 10)}.csv`,
          [{ name: 'CSV', extensions: ['csv'] }]
        )
        if (!target) return null
        writeFileSync(target, exportCsv(db), 'utf8')
        return target
      }
    }
  }

  return {
    api,
    async start() {
      queue.recover()
      queue.kick()
      try {
        await autoBackup(db, backupDir, settings.data.backupKeep)
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
