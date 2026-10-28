import { useApp } from '../lib/useApp'
import { Chinese } from './Chinese'
import { MarkedSentence } from './Cloze'
import { Synonyms } from './Synonyms'

// A sense as an entry page shows it: the definition, its synonyms, the Chinese, and the example
// with the word marked. The Chinese follows the display setting, but "never" still leaves it a
// tap away here: these pages are for reading an entry, not for testing yourself.
export function SenseBody({
  defEn,
  defZh,
  synonyms,
  example
}: {
  defEn: string
  defZh: string
  synonyms: string[]
  example: { en: string; zh: string; cloze: string[] } | null
}): React.JSX.Element {
  const { settings } = useApp()
  const setting = settings?.settings.display.chineseDisplay ?? 'always'
  const mode = setting === 'never' ? 'tap' : setting
  return (
    <>
      <p className="mt-3 text-[17px] text-ink">{defEn}</p>
      <Synonyms words={synonyms} className="mt-1 text-[15px]" />
      <Chinese mode={mode} className="mt-1 text-sm">
        {defZh}
      </Chinese>
      {example && (
        <div className="mt-3 rounded-lg bg-surface-2 px-4 py-3">
          <p className="text-[15px]">
            <MarkedSentence sentence={example.en} cloze={example.cloze} />
          </p>
          <Chinese mode={mode} className="mt-1 text-sm">
            {example.zh}
          </Chinese>
        </div>
      )}
    </>
  )
}
