import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { BackupInfo } from '../../shared/types'
import type { DB } from '../db/connection'

const PREFIX = 'wordloom-'

function stamp(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function listBackups(dir: string): BackupInfo[] {
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

function prune(dir: string, keep: number): void {
  const regular = listBackups(dir).filter((b) => b.name.startsWith(PREFIX))
  for (const old of regular.slice(Math.max(1, keep))) unlinkSync(old.file)
}

// better-sqlite3's online backup: safe while the database is open and in use.
export async function backupDatabase(
  db: DB,
  dir: string,
  keep: number,
  prefix = PREFIX
): Promise<BackupInfo> {
  mkdirSync(dir, { recursive: true })
  const name = `${prefix}${stamp(new Date())}.db`
  const file = join(dir, name)
  await db.backup(file)
  if (prefix === PREFIX) prune(dir, keep)
  const info = statSync(file)
  return { file, name, size: info.size, createdAt: info.mtimeMs }
}

/** Backs up once per calendar day, on the first start of that day. */
export async function autoBackup(
  db: DB,
  dir: string,
  keep: number,
  now = new Date()
): Promise<BackupInfo | null> {
  const today = `${PREFIX}${stamp(now).slice(0, 8)}`
  if (listBackups(dir).some((b) => b.name.startsWith(today))) return null
  return backupDatabase(db, dir, keep)
}
