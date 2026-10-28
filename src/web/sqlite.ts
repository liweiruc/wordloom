import type { Database, PreparedStatement, Sqlite3Static, SqlValue } from '@sqlite.org/sqlite-wasm'
import type { DB, RunResult, Statement } from '../main/db/types'

// The app logic was written against better-sqlite3. This gives it the same small API (see
// src/main/db/types.ts) on SQLite's own WebAssembly build, which is what the iPad runs.

// Statements are prepared once per SQL text and reused; this bounds how many stay open.
const CACHE_LIMIT = 200

function isNamed(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !ArrayBuffer.isView(value) &&
    !Array.isArray(value)
  )
}

function toSql(value: unknown): SqlValue {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  return value as SqlValue
}

export function wrapDatabase(sqlite3: Sqlite3Static, raw: Database): DB {
  const { capi } = sqlite3
  const cache = new Map<string, PreparedStatement>()

  function statementFor(sql: string): PreparedStatement {
    let stmt = cache.get(sql)
    if (!stmt) {
      stmt = raw.prepare(sql)
      if (cache.size >= CACHE_LIMIT) {
        const [oldest, old] = cache.entries().next().value!
        old.finalize()
        cache.delete(oldest)
      }
      cache.set(sql, stmt)
    }
    return stmt
  }

  // better-sqlite3 takes either positional values or one object of named ones, the names
  // written without their prefix ({ since } for @since). Every parameter must get a value.
  function bind(stmt: PreparedStatement, params: unknown[]): void {
    if (params.length === 1 && isNamed(params[0])) {
      const values = params[0]
      for (let i = 1; i <= stmt.parameterCount; i++) {
        const key = capi.sqlite3_bind_parameter_name(stmt, i)?.slice(1)
        if (!key || !(key in values)) throw new RangeError(`Missing named parameter "${key}"`)
        stmt.bind(i, toSql(values[key]))
      }
    } else if (params.length > 0) {
      stmt.bind(params.map(toSql))
    }
  }

  // Runs one use of a cached statement and resets it, so its next use starts afresh and no
  // half-read query keeps a read transaction open.
  function withStatement<T>(sql: string, params: unknown[], fn: (stmt: PreparedStatement) => T): T {
    const stmt = statementFor(sql)
    try {
      bind(stmt, params)
      return fn(stmt)
    } finally {
      stmt.reset(true)
    }
  }

  function statement(sql: string): Statement {
    statementFor(sql) // prepared now, so bad SQL fails here as it does with better-sqlite3
    return {
      get: (...params) => withStatement(sql, params, (s) => (s.step() ? s.get({}) : undefined)),
      all: (...params) =>
        withStatement(sql, params, (s) => {
          const rows: unknown[] = []
          while (s.step()) rows.push(s.get({}))
          return rows
        }),
      run: (...params): RunResult =>
        withStatement(sql, params, (s) => {
          while (s.step()) {
            // Rows a RETURNING clause produces are not asked for here.
          }
          return {
            changes: Number(raw.changes()),
            lastInsertRowid: Number(capi.sqlite3_last_insert_rowid(raw))
          }
        })
    }
  }

  return {
    prepare: statement,
    exec(sql) {
      raw.exec(sql)
    },
    transaction(fn) {
      return () =>
        capi.sqlite3_get_autocommit(raw) ? raw.transaction(() => fn()) : raw.savepoint(() => fn())
    },
    pragma(source, options) {
      const rows = raw.selectObjects(`PRAGMA ${source}`)
      if (!options?.simple) return rows
      return rows[0] ? Object.values(rows[0])[0] : undefined
    },
    close() {
      for (const stmt of cache.values()) stmt.finalize()
      cache.clear()
      raw.close()
    },
    get open() {
      return raw.isOpen()
    }
  }
}
