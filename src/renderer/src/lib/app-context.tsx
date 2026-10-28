import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { EnrichStatus, SettingsView } from '../../../shared/types'
import { api, events } from './api'
import { AppContext, type AppContextValue, type ToastTone } from './useApp'

interface Toast {
  id: number
  text: string
  tone: ToastTone
}

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [enrich, setEnrich] = useState<EnrichStatus | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  useEffect(() => {
    void api.settings.get().then(setSettings)
    void api.enrich.status().then(setEnrich)
    return events.onEnrichStatus(setEnrich)
  }, [])

  const toast = useCallback((text: string, tone: ToastTone = 'info') => {
    const id = nextId.current++
    setToasts((list) => [...list, { id, text, tone }])
    setTimeout(
      () => setToasts((list) => list.filter((t) => t.id !== id)),
      tone === 'error' ? 6000 : 3000
    )
  }, [])

  const value = useMemo<AppContextValue>(
    () => ({
      settings,
      async updateSettings(patch) {
        setSettings(await api.settings.update(patch))
      },
      async setApiKey(key) {
        setSettings(await api.settings.setApiKey(key))
        setEnrich(await api.enrich.status())
      },
      enrich,
      async refreshEnrich() {
        setEnrich(await api.enrich.status())
      },
      toast
    }),
    [settings, enrich, toast]
  )

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-5 bottom-5 z-50 flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`animate-fade-in pointer-events-auto max-w-sm rounded-lg px-4 py-2.5 text-sm shadow-lg ${
              t.tone === 'error' ? 'bg-bad-bg text-bad-ink' : 'bg-ink text-page'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  )
}
