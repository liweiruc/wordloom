import { ipcMain } from 'electron'
import { API_METHODS, type IpcEnvelope, type WordloomApi } from '../shared/api'

// One handler per API method. Results travel in an envelope so the renderer sees a plain
// error message rather than Electron's "Error invoking remote method …" wrapper.
export function registerIpc(api: WordloomApi): void {
  for (const [ns, methods] of Object.entries(API_METHODS)) {
    const target = api[ns as keyof WordloomApi] as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >
    for (const method of methods) {
      const fn = target[method]
      if (typeof fn !== 'function') throw new Error(`missing IPC handler ${ns}.${method}`)
      ipcMain.handle(
        `${ns}.${method}`,
        async (_event, ...args: unknown[]): Promise<IpcEnvelope> => {
          try {
            return { ok: true, data: await fn.apply(target, args) }
          } catch (err) {
            console.error(`[ipc] ${ns}.${method} failed:`, err)
            return { ok: false, error: err instanceof Error ? err.message : String(err) }
          }
        }
      )
    }
  }
}
