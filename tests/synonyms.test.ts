import { describe, expect, it } from 'vitest'
import { cleanSynonyms } from '../src/shared/synonyms'

describe('cleanSynonyms', () => {
  it('reads a list, or a string with any of the usual separators', () => {
    expect(cleanSynonyms(['squirm', ' twist '])).toEqual(['squirm', 'twist'])
    expect(cleanSynonyms('squirm, twist; writhe，jiggle、shake\nshift')).toEqual([
      'squirm',
      'twist',
      'writhe',
      'jiggle',
      'shake',
      'shift'
    ])
    expect(cleanSynonyms(['squirm, twist', 'writhe'])).toEqual(['squirm', 'twist', 'writhe'])
  })

  it('keeps short English phrases but not anything else', () => {
    expect(
      cleanSynonyms(['get rid of', "pull someone's leg", 'well-known', 'a piece of cake'])
    ).toEqual(['get rid of', "pull someone's leg", 'well-known', 'a piece of cake'])
    expect(
      cleanSynonyms(['扭动', 'squirm 扭动', '(informal) buddy', 'a b c d e', 'x1', '', '-dash'])
    ).toEqual([])
  })

  it('tidies quotes, full stops and spacing', () => {
    expect(cleanSynonyms(['"squirm"', 'twist.', '  get   away  '])).toEqual([
      'squirm',
      'twist',
      'get away'
    ])
  })

  it('drops repeats whatever their case, keeping the first', () => {
    expect(cleanSynonyms(['Squirm', 'squirm', 'SQUIRM', 'twist'])).toEqual(['Squirm', 'twist'])
  })

  it('lets the caller refuse some', () => {
    expect(cleanSynonyms(['squirm', 'twist'], (s) => s !== 'squirm')).toEqual(['twist'])
  })

  it('answers with an empty list for anything that is not text', () => {
    for (const value of [undefined, null, 42, true, {}, [1, null, {}]]) {
      expect(cleanSynonyms(value)).toEqual([])
    }
  })
})
