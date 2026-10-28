export const api = window.api
export const events = window.wordloomEvents

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
