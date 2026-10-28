import sqlite3InitModule, { type SAHPoolUtil, type Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import type { IpcEnvelope, WordloomApi } from '../shared/api'
import { migrate } from '../main/db/migrations'
import { createServices } from '../main/services'
import type { CallMessage, WorkerMessage } from './protocol'
import { openSecretStore } from './secrets'
import { wrapDatabase } from './sqlite'
import { createOpfsStore } from './store'

// The web app's "main process": the same services as the Windows app, on SQLite's WebAssembly
// build with the database in the browser's private storage (OPFS). The page talks to it
// through bridge.ts.

const DB_FILE = '/wordloom.db'

const post = (message: WorkerMessage): void => self.postMessage(message)

// The pool keeps its files open, so only one copy of the app can have the database. Right
// after a reload the old page's worker may still hold them for a moment, hence the retries.
// preserveOnInitFailure matters: by default a pool that fails to start deletes its storage.
async function openPool(sqlite3: Sqlite3Static): Promise<SAHPoolUtil> {
  const options = {
    name: 'wordloom',
    preserveOnInitFailure: true,
    // Not in the typings: retry instead of returning the cached failure.
    forceReinitIfPreviouslyFailed: true
  }
  for (let attempt = 1; ; attempt++) {
    try {
      return await sqlite3.installOpfsSAHPoolVfs(options)
    } catch (err) {
      if (attempt === 10) {
        throw new Error(
          '打不开这台设备上的数据。Wordloom 可能已经在另一个窗口或标签页里打开了，请关掉它再刷新；或者这个浏览器太旧，不支持本机存储。',
          { cause: err }
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
}

async function start(): Promise<WordloomApi> {
  const sqlite3 = await sqlite3InitModule()
  const pool = await openPool(sqlite3)
  const raw = new pool.OpfsSAHPoolDb(DB_FILE)
  const db = wrapDatabase(sqlite3, raw)
  db.pragma('foreign_keys = ON')
  // Temporary tables and sorts stay in memory instead of taking files from the pool.
  db.pragma('temp_store = MEMORY')
  migrate(db)
  const services = createServices({
    db,
    store: createOpfsStore(sqlite3, raw, pool, DB_FILE),
    secrets: await openSecretStore(),
    platform: {
      send: (channel, payload) => post({ type: 'event', channel, payload }),
      relaunch() {
        // The database is closed by now. Letting go of the pool's files lets the reloaded
        // page's worker open them.
        pool.pauseVfs()
        post({ type: 'reload' })
      }
    }
  })
  void services.start()
  return services.api
}

const ready = start()
ready.catch((err: unknown) => {
  console.error('[worker] start failed:', err)
  post({ type: 'failed', message: err instanceof Error ? err.message : String(err) })
})

// One handler for every API method, like src/main/ipc.ts: results go back in an envelope so
// the page sees a plain error message.
async function call({ method, args }: CallMessage): Promise<IpcEnvelope> {
  try {
    const api = await ready
    const [ns, name] = method.split('.')
    const target = api[ns as keyof WordloomApi] as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >
    return { ok: true, data: await target[name](...args) }
  } catch (err) {
    console.error(`[worker] ${method} failed:`, err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

self.addEventListener('message', (e: MessageEvent<CallMessage>) => {
  void call(e.data).then((result) => post({ type: 'result', id: e.data.id, result }))
})
