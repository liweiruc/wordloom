import { Fragment } from 'react'
import { splitCloze } from '../../../shared/cloze'

// Example sentences are set in italic wherever they appear. Only the English: the Chinese
// translation stays upright, as Chinese type has no italic and a slanted one looks wrong.

// The sentence with the word taken out. Each blank is sized from the text it hides, so it
// hints at length without spelling anything out; a split phrasal verb gets one blank per part.
export function ClozeSentence({
  sentence,
  cloze
}: {
  sentence: string
  cloze: string[]
}): React.JSX.Element {
  const segments = splitCloze(sentence, cloze)
  if (!segments) return <span className="italic">{sentence}</span>
  return (
    <span className="italic">
      {segments.map((s, i) =>
        s.blank ? (
          <span
            key={i}
            aria-label="空格"
            className="mx-0.5 inline-block translate-y-[3px] border-b-2 border-ink"
            style={{ width: Math.min(200, Math.max(56, s.text.length * 13)) }}
          />
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        )
      )}
    </span>
  )
}

// The answer side's copy: the blanks filled back in and marked, so the first thing the
// learner sees is whether the word they thought of was the one.
export function MarkedSentence({
  sentence,
  cloze
}: {
  sentence: string
  cloze: string[]
}): React.JSX.Element {
  const segments = splitCloze(sentence, cloze)
  if (!segments) return <span className="italic">{sentence}</span>
  return (
    <span className="italic">
      {segments.map((s, i) =>
        s.blank ? (
          <mark key={i} className="rounded bg-accent-soft px-0.5 font-semibold text-ink">
            {s.text}
          </mark>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        )
      )}
    </span>
  )
}
