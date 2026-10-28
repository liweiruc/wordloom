import { describe, expect, it } from 'vitest'
import { editDistance, judgeAnswer, normalizeAnswer, suggestGrade } from '../src/shared/answer'
import { clozeAnswer, findWhole, letterHint, splitCloze } from '../src/shared/cloze'

describe('splitCloze', () => {
  it('blanks a single inflected form', () => {
    expect(splitCloze('He struck the ball hard.', ['struck'])).toEqual([
      { text: 'He ', blank: false },
      { text: 'struck', blank: true },
      { text: ' the ball hard.', blank: false }
    ])
  })

  it('blanks the parts of a split phrasal verb in order', () => {
    const segments = splitCloze('That taxi driver totally ripped us off.', ['ripped', 'off'])
    expect(segments?.filter((s) => s.blank).map((s) => s.text)).toEqual(['ripped', 'off'])
    expect(segments?.map((s) => s.text).join('')).toBe('That taxi driver totally ripped us off.')
  })

  it('matches case-insensitively and across apostrophe styles', () => {
    const segments = splitCloze('Don’t Wiggle now.', ["don't", 'wiggle'])
    expect(segments?.filter((s) => s.blank).map((s) => s.text)).toEqual(['Don’t', 'Wiggle'])
  })

  it('never blanks part of a longer word', () => {
    expect(findWhole('fran ran fast', 'ran')).toBe(5)
    expect(splitCloze('Start the art class.', ['art'])?.find((s) => s.blank)?.text).toBe('art')
    expect(splitCloze('She was running late.', ['run'])).toBeNull()
  })

  it('returns null when a part is missing or out of order', () => {
    expect(splitCloze('They ripped us off.', ['off', 'ripped'])).toBeNull()
    expect(splitCloze('Nothing here.', ['yield'])).toBeNull()
  })

  it('joins the parts into the expected answer', () => {
    expect(clozeAnswer([' ripped ', 'off'])).toBe('ripped off')
  })

  it('hints with the first letter and the length only', () => {
    expect(letterHint(['wiggle'])).toBe('w _ _ _ _ _')
    expect(letterHint(['ripped', 'off'])).toBe('r _ _ _ _ _   …   o _ _')
    expect(letterHint(['self-esteem'])).toBe('s _ _ _ - _ _ _ _ _ _')
  })
})

describe('judgeAnswer', () => {
  const struck = { cloze: ['struck'], headword: 'strike', variants: [] }

  it('accepts the exact form, ignoring case and stray punctuation', () => {
    expect(judgeAnswer('Struck.', struck)).toBe('correct')
  })

  it('calls the base form a wrong form, not a wrong word', () => {
    expect(judgeAnswer('strike', struck)).toBe('wrong_form')
    expect(judgeAnswer('strikes', struck)).toBe('wrong_form')
    expect(
      judgeAnswer('rip off', { cloze: ['ripped', 'off'], headword: 'rip off', variants: [] })
    ).toBe('wrong_form')
  })

  it('treats one slip as a typo, scaled to the word length', () => {
    expect(judgeAnswer('struk', struck)).toBe('typo')
    const long = { cloze: ['procrastinate'], headword: 'procrastinate', variants: [] }
    expect(judgeAnswer('procrastinte', long)).toBe('typo')
    expect(judgeAnswer('procarstinte', long)).toBe('typo')
    expect(judgeAnswer('pod', { cloze: ['pot'], headword: 'pot', variants: [] })).toBe('wrong')
  })

  it('treats hyphen and space as the same', () => {
    const target = { cloze: ['self-esteem'], headword: 'self-esteem', variants: [] }
    expect(judgeAnswer('self esteem', target)).toBe('correct')
    expect(judgeAnswer('selfesteem', target)).toBe('correct')
  })

  it('accepts listed spelling variants with the same ending', () => {
    const target = { cloze: ['odors'], headword: 'odor', variants: ['odour'] }
    expect(judgeAnswer('odours', target)).toBe('correct')
  })

  it('marks other words and empty input wrong', () => {
    expect(judgeAnswer('hit', struck)).toBe('wrong')
    expect(judgeAnswer('   ', struck)).toBe('wrong')
  })
})

describe('suggestGrade', () => {
  it('maps outcomes to a default rating', () => {
    expect(suggestGrade('correct', 0)).toBe(3)
    expect(suggestGrade('correct', 1)).toBe(2)
    expect(suggestGrade('typo', 0)).toBe(2)
    expect(suggestGrade('wrong_form', 0)).toBe(2)
    expect(suggestGrade('wrong', 0)).toBe(1)
    expect(suggestGrade('gave_up', 0)).toBe(1)
    expect(suggestGrade('known', 0)).toBe(4)
  })
})

describe('helpers', () => {
  it('normalizes answers', () => {
    expect(normalizeAnswer('  Don’t   Stop! ')).toBe("don't stop")
  })

  it('counts an adjacent swap as one edit', () => {
    expect(editDistance('recieve', 'receive')).toBe(1)
    expect(editDistance('kitten', 'sitting')).toBe(3)
  })
})
