import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// The suites of vitest.config.mts with the database on SQLite's WebAssembly build, as in the
// iPad web app, instead of better-sqlite3: every import of db/connection gets
// tests/wasm-connection.ts.
export default defineConfig({
  resolve: {
    alias: [{ find: /^.*\/db\/connection$/, replacement: resolve('tests/wasm-connection.ts') }]
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
