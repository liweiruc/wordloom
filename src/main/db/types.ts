// The part of the SQLite API the app uses. better-sqlite3 provides it on Windows; on the iPad
// src/web/sqlite.ts provides it on top of SQLite's WebAssembly build. Keeping this file free of
// imports lets the web build use the app logic without pulling in anything from Node.

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface Statement {
  /** The first result row, or undefined when there is none. */
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  run(...params: unknown[]): RunResult
}

export interface DB {
  prepare(sql: string): Statement
  exec(sql: string): unknown
  /** Wraps fn so that calling it runs it in one transaction (a savepoint when nested). */
  transaction<T>(fn: () => T): () => T
  pragma(source: string, options?: { simple?: boolean }): unknown
  close(): unknown
  readonly open: boolean
}
