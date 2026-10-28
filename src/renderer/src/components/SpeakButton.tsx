import { Volume2 } from 'lucide-react'
import { useApp } from '../lib/useApp'
import { speak } from '../lib/speech'

export function SpeakButton({
  text,
  size = 16
}: {
  text: string
  size?: number
}): React.JSX.Element {
  const { settings } = useApp()
  const display = settings?.settings.display
  return (
    <button
      type="button"
      title="发音"
      aria-label={`朗读 ${text}`}
      onClick={() =>
        speak(text, { voice: display?.voice ?? '', speechRate: display?.speechRate ?? 0.9 })
      }
      className="inline-flex cursor-pointer items-center justify-center rounded-md p-1 text-accent-text hover:bg-accent-soft"
    >
      <Volume2 size={size} />
    </button>
  )
}
