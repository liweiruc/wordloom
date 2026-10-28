export interface DiffChar {
  ch: string
  ok: boolean
}

// Character alignment between what was typed and what was expected (case-insensitive), so a
// near miss can show exactly which letters were wrong or missing.
export function diffChars(
  given: string,
  expected: string
): { given: DiffChar[]; expected: DiffChar[] } {
  const a = given.toLowerCase()
  const b = expected.toLowerCase()
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
  }
  const marksA = [...given].map((ch) => ({ ch, ok: true }))
  const marksB = [...expected].map((ch) => ({ ch, ok: true }))
  let i = a.length
  let j = b.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      if (a[i - 1] !== b[j - 1]) {
        marksA[i - 1].ok = false
        marksB[j - 1].ok = false
      }
      i--
      j--
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      marksA[i - 1].ok = false
      i--
    } else {
      marksB[j - 1].ok = false
      j--
    }
  }
  return { given: marksA, expected: marksB }
}
