// A sense's synonyms, set under its English definition. The caller sets the size and spacing.
export function Synonyms({
  words,
  className = ''
}: {
  words: string[]
  className?: string
}): React.JSX.Element | null {
  if (words.length === 0) return null
  return (
    <p className={`text-ink-2 ${className}`}>
      <span className="mr-2 text-xs text-ink-3">近义词</span>
      {words.join(', ')}
    </p>
  )
}
