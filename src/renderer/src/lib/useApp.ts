import { createContext, useContext } from 'react'
import type { EnrichStatus, SettingsPatch, SettingsView } from '../../../shared/types'

export type ToastTone = 'info' | 'error'

export interface AppContextValue {
  settings: SettingsView | null
  updateSettings(patch: SettingsPatch): Promise<void>
  setApiKey(key: string): Promise<void>
  enrich: EnrichStatus | null
  refreshEnrich(): Promise<void>
  toast(text: string, tone?: ToastTone): void
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}
