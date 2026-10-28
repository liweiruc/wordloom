import type { SecretStore } from '../main/services'

// The API key is kept in IndexedDB rather than in the SQLite file, so an exported database
// never carries it and restoring one does not drop it. It is read once at start, which lets
// the services ask for it synchronously, as they do on Windows.

const IDB_NAME = 'wordloom'
const STORE = 'secrets'
const API_KEY = 'llmApiKey'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () => reject(tx.error)
  })
}

export async function openSecretStore(): Promise<SecretStore> {
  const open = indexedDB.open(IDB_NAME, 1)
  open.onupgradeneeded = () => open.result.createObjectStore(STORE)
  const idb = await request(open)
  const stored = await request(idb.transaction(STORE).objectStore(STORE).get(API_KEY))
  let apiKey = typeof stored === 'string' ? stored : null
  return {
    has: () => apiKey !== null,
    load: () => apiKey,
    async save(key) {
      const trimmed = key.trim()
      const tx = idb.transaction(STORE, 'readwrite')
      if (trimmed) tx.objectStore(STORE).put(trimmed, API_KEY)
      else tx.objectStore(STORE).delete(API_KEY)
      await committed(tx)
      apiKey = trimmed || null
    }
  }
}
