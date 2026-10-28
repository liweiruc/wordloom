import type { IpcEnvelope } from '../shared/api'

// The messages between the page (bridge.ts) and the worker that runs the app logic
// (worker.ts): the web app's stand-in for Electron's IPC.

/** A call of one API method, named "<namespace>.<method>" as in API_METHODS. */
export interface CallMessage {
  id: number
  method: string
  args: unknown[]
}

export type WorkerMessage =
  | { type: 'result'; id: number; result: IpcEnvelope }
  | { type: 'event'; channel: string; payload: unknown }
  /** The database file was replaced; the page reloads to start over on it. */
  | { type: 'reload' }
  /** The worker could not open the database; every call will fail with this message. */
  | { type: 'failed'; message: string }
