import type { WordloomApi, WordloomEvents } from '../shared/api'

declare global {
  interface Window {
    api: WordloomApi
    wordloomEvents: WordloomEvents
    files: { pathFor(file: File): string }
  }
}

export {}
