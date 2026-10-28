import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { checkDatabaseFile } from '../src/main/data/backup'
import { openDatabase } from '../src/main/db/connection'
import { migrate, SCHEMA_VERSION } from '../src/main/db/migrations'
import { createServices, type DataStore } from '../src/main/services'

// The start of a SQLite file, which is all checkDatabaseFile reads: the magic string, and
// PRAGMA user_version (the schema version) big-endian at offset 60.
function header(userVersion: number): Uint8Array {
  const bytes = new Uint8Array(4096)
  bytes.set(new TextEncoder().encode('SQLite format 3\0'))
  new DataView(bytes.buffer).setUint32(60, userVersion)
  return bytes
}

describe('checkDatabaseFile', () => {
  it('accepts a Wordloom database', () => {
    const db = new Database(':memory:')
    migrate(db)
    expect(() => checkDatabaseFile(db.serialize())).not.toThrow()
    db.close()
  })

  it('refuses other files, empty databases and ones from a newer version', () => {
    expect(() => checkDatabaseFile(new TextEncoder().encode('1, apple  英译中'))).toThrow(
      '不是 Wordloom 的数据库文件'
    )
    expect(() => checkDatabaseFile(header(0))).toThrow('没有 Wordloom 的数据')
    expect(() => checkDatabaseFile(header(SCHEMA_VERSION + 1))).toThrow('更新版本')
  })
})

describe('restoring a database file', () => {
  function setup(): {
    db: ReturnType<typeof openDatabase>
    restoreFile(bytes: Uint8Array): Promise<void>
    calls: string[]
  } {
    const db = openDatabase(':memory:')
    const calls: string[] = []
    const store: DataStore = {
      info: { kind: 'browser' },
      listBackups: async () => [],
      async backup(_keep, prefix) {
        calls.push(`backup ${prefix}`)
        return { file: 'b.db', name: 'b.db', size: 0, createdAt: 0 }
      },
      readBackup: async () => new Uint8Array(),
      snapshot: async () => new Uint8Array(),
      async replace(bytes) {
        calls.push(`replace ${bytes.length} bytes, database open: ${db.open}`)
      }
    }
    const { api } = createServices({
      db,
      store,
      secrets: { has: () => false, load: () => null, save: () => undefined },
      platform: { send: () => undefined, relaunch: () => calls.push('relaunch') }
    })
    return { db, restoreFile: (bytes) => api.data.restoreFile(bytes), calls }
  }

  it('keeps a backup, closes the database, swaps the file in and restarts', async () => {
    const { restoreFile, calls } = setup()
    await restoreFile(header(SCHEMA_VERSION))
    expect(calls).toEqual([
      'backup pre-restore-',
      'replace 4096 bytes, database open: false',
      'relaunch'
    ])
  })

  it('changes nothing when the file is not a Wordloom database', async () => {
    const { db, restoreFile, calls } = setup()
    await expect(restoreFile(new TextEncoder().encode('hello'))).rejects.toThrow(
      '不是 Wordloom 的数据库文件'
    )
    expect(calls).toEqual([])
    expect(db.open).toBe(true)
    db.close()
  })
})
