import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { DB } from '../src/main/db/types'
import { wrapDatabase } from '../src/web/sqlite'

// src/web/sqlite.ts gives SQLite's WebAssembly build the part of better-sqlite3's API that
// the app uses. Every case runs on both, so the two have to agree.

const sqlite3 = await sqlite3InitModule()
const engines: [string, () => DB][] = [
  ['better-sqlite3', () => new Database(':memory:')],
  ['sqlite-wasm', () => wrapDatabase(sqlite3, new sqlite3.oo1.DB(':memory:'))]
]

describe.each(engines)('%s', (_, open) => {
  function withTable(): DB {
    const db = open()
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, n INTEGER)')
    return db
  }

  it('binds positional and named parameters', () => {
    const db = withTable()
    db.prepare('INSERT INTO t (name, n) VALUES (?, ?)').run('a', 1)
    db.prepare('INSERT INTO t (name, n) VALUES (@name, @n)').run({ name: 'b', n: 2 })
    db.prepare('INSERT INTO t (name, n) VALUES (:name, $n)').run({ name: 'c', n: null })
    expect(db.prepare('SELECT name, n FROM t ORDER BY id').all()).toEqual([
      { name: 'a', n: 1 },
      { name: 'b', n: 2 },
      { name: 'c', n: null }
    ])
    expect(() => db.prepare('SELECT * FROM t WHERE name = @name').get({})).toThrow(
      /Missing named parameter/
    )
  })

  it('reports the changes and the new row id from run()', () => {
    const db = withTable()
    expect(db.prepare('INSERT INTO t (name) VALUES (?)').run('a')).toEqual({
      changes: 1,
      lastInsertRowid: 1
    })
    db.prepare('INSERT INTO t (name) VALUES (?)').run('b')
    expect(db.prepare('UPDATE t SET n = 0').run().changes).toBe(2)
  })

  it('returns undefined or no rows when nothing matches', () => {
    const db = withTable()
    expect(db.prepare('SELECT * FROM t').get()).toBeUndefined()
    expect(db.prepare('SELECT * FROM t').all()).toEqual([])
  })

  it('starts every use of a statement afresh', () => {
    const db = withTable()
    db.prepare('INSERT INTO t (name) VALUES (?), (?)').run('a', 'b')
    const names = db.prepare('SELECT name FROM t ORDER BY id')
    expect(names.get()).toEqual({ name: 'a' })
    expect(db.prepare('SELECT name FROM t ORDER BY id').get()).toEqual({ name: 'a' })
    expect(names.all()).toEqual([{ name: 'a' }, { name: 'b' }])
  })

  it('rolls back a failed transaction, and a failed nested one on its own', () => {
    const db = withTable()
    const insert = db.prepare('INSERT INTO t (name) VALUES (?)')
    const failing = db.transaction(() => {
      insert.run('lost')
      throw new Error('boom')
    })
    expect(failing).toThrow('boom')
    db.transaction(() => {
      insert.run('kept')
      expect(failing).toThrow('boom')
      insert.run('kept too')
    })()
    expect(db.prepare('SELECT name FROM t ORDER BY id').all()).toEqual([
      { name: 'kept' },
      { name: 'kept too' }
    ])
  })

  it('reads pragmas as a value or as rows', () => {
    const db = withTable()
    db.pragma('user_version = 7')
    expect(db.pragma('user_version', { simple: true })).toBe(7)
    expect(db.pragma('user_version')).toEqual([{ user_version: 7 }])
  })

  it('rejects bad SQL when it is prepared, and closes', () => {
    const db = withTable()
    expect(() => db.prepare('SELEC name FROM t')).toThrow()
    expect(db.open).toBe(true)
    db.close()
    expect(db.open).toBe(false)
  })
})
