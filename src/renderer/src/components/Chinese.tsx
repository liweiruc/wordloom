import { useState, type ReactNode } from 'react'
import type { ChineseDisplay } from '../../../shared/types'

// English first: Chinese is shown per the learner's setting. "tap" keeps it folded behind a
// small button, so reading the English comes before reaching for the translation.
export function Chinese({
  mode,
  children,
  className = ''
}: {
  mode: ChineseDisplay
  children: ReactNode
  className?: string
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (mode === 'never') return null
  if (mode === 'always' || open) return <div className={`text-ink-2 ${className}`}>{children}</div>
  // The wrapper takes the caller's spacing; the button keeps its own small size, even
  // inside a 24px sentence.
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer rounded-md bg-surface-2 px-2 py-0.5 align-middle text-xs leading-5 text-ink-2 hover:bg-surface-3"
      >
        中文
      </button>
    </div>
  )
}
