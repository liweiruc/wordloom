import type { BackupInfo } from '../../shared/types'
import { SCHEMA_VERSION } from '../db/migrations'
import type { DataStore } from '../services'

// Backups are named the same way on every platform; only regular ones (this prefix) are
// pruned, so a pre-restore copy or a file put there by hand is never deleted.
export const BACKUP_PREFIX = 'wordloom-'

function stamp(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function backupName(prefix = BACKUP_PREFIX, d = new Date()): string {
  return `${prefix}${stamp(d)}.db`
}

/** The regular backups past the newest `keep` (at least one stays), given newest first. */
export function backupsToPrune(backups: BackupInfo[], keep: number): BackupInfo[] {
  return backups.filter((b) => b.name.startsWith(BACKUP_PREFIX)).slice(Math.max(1, keep))
}

/** Backs up once per calendar day, on the first start of that day. */
export async function autoBackup(
  store: DataStore,
  keep: number,
  now = new Date()
): Promise<BackupInfo | null> {
  const today = `${BACKUP_PREFIX}${stamp(now).slice(0, 8)}`
  if ((await store.listBackups()).some((b) => b.name.startsWith(today))) return null
  return store.backup(keep)
}

const SQLITE_MAGIC = 'SQLite format 3\0'

/** Throws unless the bytes are a Wordloom database this version of the app can open. */
export function checkDatabaseFile(bytes: Uint8Array): void {
  const magic = new TextDecoder().decode(bytes.subarray(0, 16))
  if (bytes.length < 100 || magic !== SQLITE_MAGIC) {
    throw new Error('这不是 Wordloom 的数据库文件（.db）。')
  }
  // PRAGMA user_version lives in the file header: four bytes, big-endian, at offset 60.
  const version = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(60)
  if (version === 0) throw new Error('这个数据库文件里没有 Wordloom 的数据。')
  if (version > SCHEMA_VERSION) {
    throw new Error('这个文件来自更新版本的 Wordloom，请先更新应用再恢复。')
  }
}
