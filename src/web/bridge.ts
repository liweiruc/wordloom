import { registerSW } from 'virtual:pwa-register'
import { API_METHODS, EVENT_CHANNELS, type WordloomApi, type WordloomEvents } from '../shared/api'
import type { CallMessage, WorkerMessage } from './protocol'

// Plays the part of Electron's preload (src/preload/index.ts) in the web app: window.api has
// one async function per API method, each a message to the worker that runs the app logic.

type Invoker = (...args: unknown[]) => Promise<unknown>

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
const pending = new Map<number, { resolve(data: unknown): void; reject(err: Error): void }>()
const listeners = new Map<string, Set<(payload: unknown) => void>>()
let nextId = 1

worker.addEventListener('message', (e: MessageEvent<WorkerMessage>) => {
  const message = e.data
  if (message.type === 'result') {
    const call = pending.get(message.id)
    pending.delete(message.id)
    if (message.result.ok) call?.resolve(message.result.data)
    else call?.reject(new Error(message.result.error))
  } else if (message.type === 'event') {
    listeners.get(message.channel)?.forEach((listener) => listener(message.payload))
  } else if (message.type === 'reload') {
    location.reload()
  } else {
    showNotice(message.message, { cover: true })
  }
})

const api: Record<string, Record<string, Invoker>> = {}
for (const [ns, methods] of Object.entries(API_METHODS)) {
  const group: Record<string, Invoker> = {}
  for (const method of methods) {
    group[method] = (...args) =>
      new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        worker.postMessage({ id, method: `${ns}.${method}`, args } satisfies CallMessage)
      })
  }
  api[ns] = group
}

function subscribe(channel: string) {
  return (listener: (payload: unknown) => void): (() => void) => {
    const set = listeners.get(channel) ?? new Set()
    listeners.set(channel, set)
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  }
}

window.api = api as unknown as WordloomApi
window.wordloomEvents = {
  onEnrichStatus: subscribe(EVENT_CHANNELS.enrichStatus),
  onTriageProgress: subscribe(EVENT_CHANNELS.triageProgress)
} as WordloomEvents

// Asks the browser to keep Wordloom's storage even when space runs low. Safari grants this to
// apps added to the Home Screen.
void navigator.storage?.persist?.()

// A new version is only offered, never loaded on its own, so it cannot cut into a study round.
const updateServiceWorker = registerSW({
  onNeedRefresh() {
    showNotice('Wordloom 有新版本。', {
      action: { label: '重新加载', run: () => void updateServiceWorker(true) }
    })
  }
})

// Messages from outside the renderer, which is shared with the Windows app; they use its
// colour tokens (styles.css) but not its classes.
function showNotice(
  text: string,
  { action, cover = false }: { action?: { label: string; run(): void }; cover?: boolean } = {}
): void {
  const box = document.createElement('div')
  box.setAttribute('role', cover ? 'alert' : 'status')
  box.style.cssText = cover
    ? 'position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:32px;background:var(--page);color:var(--ink);font-size:16px;line-height:1.6;text-align:center'
    : 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100;display:flex;align-items:center;gap:12px;max-width:calc(100% - 32px);padding:10px 16px;border-radius:10px;background:var(--ink);color:var(--page);font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,0.2)'
  const label = document.createElement('span')
  label.textContent = text
  label.style.maxWidth = '36em'
  box.append(label)
  if (action) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = action.label
    button.style.cssText =
      'font-weight:600;text-decoration:underline;cursor:pointer;background:none;border:0;padding:0;color:inherit'
    button.addEventListener('click', action.run)
    box.append(button)
  }
  document.body.append(box)
}
