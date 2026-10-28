import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { migrate } from '../src/main/db/migrations'
import type { DB } from '../src/main/db/types'
import { wrapDatabase } from '../src/web/sqlite'

// Stands in for src/main/db/connection.ts under `npm run test:wasm`, so that every suite also
// runs on SQLite's WebAssembly build (the iPad's database) through src/web/sqlite.ts.

export type { DB }

const sqlite3 = await sqlite3InitModule()

export function openDatabase(file: string): DB {
  if (file !== ':memory:') throw new Error('the WebAssembly test database is in memory only')
  const db = wrapDatabase(sqlite3, new sqlite3.oo1.DB(':memory:'))
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}
