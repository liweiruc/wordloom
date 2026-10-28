import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { errorText } from './api'

export interface AsyncState<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  reload: () => void
  setData: (value: T) => void
}

interface Settled<T> {
  key: string | null
  data: T | undefined
  error: string | null
}

// Loads data for a page and reloads it whenever `deps` (plain values) change. Each result
// is tagged with the request it answers, so "loading" is simply "the latest result is for
// an older request". While a reload runs the previous data stays on screen: nothing flashes.
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [tick, setTick] = useState(0)
  const [settled, setSettled] = useState<Settled<T>>({ key: null, data: undefined, error: null })
  const key = JSON.stringify([...deps, tick])
  const loadRef = useRef(load)
  useLayoutEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    let cancelled = false
    loadRef.current().then(
      (data) => {
        if (!cancelled) setSettled({ key, data, error: null })
      },
      (err) => {
        if (!cancelled) setSettled((s) => ({ key, data: s.data, error: errorText(err) }))
      }
    )
    return () => {
      cancelled = true
    }
  }, [key])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  const setData = useCallback((data: T) => setSettled((s) => ({ ...s, data, error: null })), [])
  return { data: settled.data, error: settled.error, loading: settled.key !== key, reload, setData }
}
