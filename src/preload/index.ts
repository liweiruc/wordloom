import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { API_METHODS, EVENT_CHANNELS, type IpcEnvelope } from '../shared/api'

type Invoker = (...args: unknown[]) => Promise<unknown>

// The renderer gets one async function per API method and nothing else from Node.
const api: Record<string, Record<string, Invoker>> = {}
for (const [ns, methods] of Object.entries(API_METHODS)) {
  const group: Record<string, Invoker> = {}
  for (const method of methods) {
    group[method] = async (...args) => {
      const res = (await ipcRenderer.invoke(`${ns}.${method}`, ...args)) as IpcEnvelope
      if (!res.ok) throw new Error(res.error)
      return res.data
    }
  }
  api[ns] = group
}

function subscribe(channel: string) {
  return (listener: (payload: unknown) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('wordloomEvents', {
  onEnrichStatus: subscribe(EVENT_CHANNELS.enrichStatus),
  onTriageProgress: subscribe(EVENT_CHANNELS.triageProgress)
})
