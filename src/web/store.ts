import type { Database, SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import type { BackupInfo } from '../shared/types'
import { BACKUP_PREFIX, backupName, backupsToPrune } from '../main/data/backup'
import type { DataStore } from '../main/services'

// The web app's data: the database lives in the SAH pool's OPFS folder, which the pool treats
// as entirely its own, so backups go to a folder of their own next to it.

async function backupFolder(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('backups', { create: true })
}

async function listBackups(folder: FileSystemDirectoryHandle): Promise<BackupInfo[]> {
  const backups: BackupInfo[] = []
  for await (const handle of folder.values()) {
    if (handle.kind !== 'file' || !handle.name.endsWith('.db')) continue
    const file = await (handle as FileSystemFileHandle).getFile()
    backups.push({
      file: file.name,
      name: file.name,
      size: file.size,
      createdAt: file.lastModified
    })
  }
  return backups.sort((a, b) => b.createdAt - a.createdAt)
}

// A worker can write OPFS files through a sync access handle, which every browser with OPFS
// supports (Safari has no createWritable).
async function writeFile(
  folder: FileSystemDirectoryHandle,
  name: string,
  bytes: Uint8Array
): Promise<void> {
  const handle = await folder.getFileHandle(name, { create: true })
  const access = await handle.createSyncAccessHandle()
  try {
    access.truncate(0)
    access.write(bytes, { at: 0 })
    access.flush()
  } finally {
    access.close()
  }
}

export function createOpfsStore(
  sqlite3: Sqlite3Static,
  db: Database,
  pool: SAHPoolUtil,
  dbFile: string
): DataStore {
  const snapshot = (): Uint8Array => sqlite3.capi.sqlite3_js_db_export(db)
  return {
    info: { kind: 'browser' },
    async listBackups() {
      return listBackups(await backupFolder())
    },
    async backup(keep, prefix = BACKUP_PREFIX) {
      const folder = await backupFolder()
      const name = backupName(prefix)
      await writeFile(folder, name, snapshot())
      let backups = await listBackups(folder)
      if (prefix === BACKUP_PREFIX) {
        for (const old of backupsToPrune(backups, keep)) await folder.removeEntry(old.name)
        backups = await listBackups(folder)
      }
      return backups.find((b) => b.name === name)!
    },
    async readBackup(name) {
      const folder = await backupFolder()
      const handle = await folder.getFileHandle(name).catch(() => null)
      if (!handle) throw new Error('备份文件不存在。')
      return new Uint8Array(await (await handle.getFile()).arrayBuffer())
    },
    async snapshot() {
      return snapshot()
    },
    // importDb also clears the WAL flag that databases from the Windows app carry; this VFS
    // cannot open a file in WAL mode.
    async replace(bytes) {
      await pool.importDb(dbFile, bytes)
    }
  }
}
