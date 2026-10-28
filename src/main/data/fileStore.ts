import type Database from 'better-sqlite3'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import type { BackupInfo } from '../../shared/types'
import type { DataStore } from '../services'
import { BACKUP_PREFIX, backupName, backupsToPrune } from './backup'

function listBackups(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.db'))
    .map((name) => {
      const file = join(dir, name)
      const info = statSync(file)
      return { file, name, size: info.size, createdAt: info.mtimeMs }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** The Windows app's data: the database file, with its backups in a folder next to it. */
export function createFileStore(
  db: Database.Database,
  dbFile: string,
  dataDir: string,
  openPath: (path: string) => Promise<void>
): DataStore {
  const dir = join(dataDir, 'backups')
  return {
    info: { kind: 'folder', path: dataDir },
    openFolder: () => openPath(dataDir),
    async listBackups() {
      return listBackups(dir)
    },
    // better-sqlite3's online backup: safe while the database is open and in use.
    async backup(keep, prefix = BACKUP_PREFIX) {
      mkdirSync(dir, { recursive: true })
      const name = backupName(prefix)
      const file = join(dir, name)
      await db.backup(file)
      if (prefix === BACKUP_PREFIX) {
        for (const old of backupsToPrune(listBackups(dir), keep)) unlinkSync(old.file)
      }
      const info = statSync(file)
      return { file, name, size: info.size, createdAt: info.mtimeMs }
    },
    async readBackup(file) {
      if (!existsSync(file)) throw new Error('备份文件不存在。')
      return readFileSync(file)
    },
    async snapshot() {
      return db.serialize()
    },
    async replace(bytes) {
      for (const suffix of ['-wal', '-shm']) rmSync(dbFile + suffix, { force: true })
      writeFileSync(dbFile, bytes)
    }
  }
}
