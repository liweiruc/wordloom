// Live check of the DeepSeek prompts and validators on a handful of representative words:
//   $env:DEEPSEEK_API_KEY = 'sk-…'; npm run smoke:llm
// or on the first headwords of a word file, extracted the way an import extracts them:
//   npm run smoke:llm -- 20261025.txt 10
// Optional: DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, and DEEPSEEK_THINKING=on to leave DeepSeek's
// thinking mode on (the app turns it off). Prints the clean-up verdicts, every generated
// sense, any problems the validator found, and the token totals.
import { readFileSync } from 'fs'
import { basename } from 'path'
import { openDatabase } from '../src/main/db/connection'
import { DEFAULT_SETTINGS } from '../src/main/db/settings'
import { decodeText } from '../src/main/import/decode'
import { buildPreview } from '../src/main/import/preview'
import { LlmClient } from '../src/main/llm/client'
import { enrichWords, type EnrichOutcome, type LlmCallRecord } from '../src/main/llm/enrich'
import { triageWords } from '../src/main/llm/triage'

const TRIAGE = [
  'thresholds',
  'harrass',
  'Jerusalem',
  'self esteem',
  'unhinged',
  'wiggle',
  'gunmen',
  'odor',
  'hostilities',
  'tailgated'
]
const ENRICH = [
  'yield to',
  'rip off',
  'strike',
  'wiggle',
  'give or take',
  'unhinged',
  'Jerusalem',
  'self-esteem',
  'threshold',
  'sync'
]

function firstHeadwords(file: string, count: number): string[] {
  const { text, encoding } = decodeText(readFileSync(file))
  const preview = buildPreview(openDatabase(':memory:'), [{ name: basename(file), encoding, text }])
  return preview.candidates.slice(0, count).map((c) => c.headword)
}

async function main(): Promise<void> {
  const [file, count = '10'] = process.argv.slice(2)
  const fromFile = file ? firstHeadwords(file, Number(count)) : null
  if (fromFile) console.log(`${basename(file)}: ${fromFile.join(', ')}`)
  const triageList = fromFile ?? TRIAGE
  const enrichList = fromFile ?? ENRICH

  const apiKey = process.env['DEEPSEEK_API_KEY']
  if (!apiKey) {
    console.error('Set DEEPSEEK_API_KEY first.')
    process.exit(1)
  }
  const client = new LlmClient({
    apiKey,
    baseUrl: process.env['DEEPSEEK_BASE_URL'] ?? DEFAULT_SETTINGS.llm.baseUrl,
    model: process.env['DEEPSEEK_MODEL'] ?? DEFAULT_SETTINGS.llm.model,
    keepThinking: process.env['DEEPSEEK_THINKING'] === 'on'
  })
  const calls: LlmCallRecord[] = []
  const record = (call: LlmCallRecord): void => {
    calls.push(call)
  }

  console.log((await client.check()).message)

  const triage = await triageWords({ client, record }, triageList)
  console.table(
    triage.map((t) => ({
      input: t.input,
      kind: t.kind,
      suggestion: t.suggestion,
      keep: t.keepSeparate,
      note: t.note
    }))
  )

  // In batches of the size the app sends.
  const { batchSize, maxSenses } = DEFAULT_SETTINGS.llm
  const started = Date.now()
  const outcomes: EnrichOutcome[] = []
  for (let i = 0; i < enrichList.length; i += batchSize) {
    const batch = enrichList.slice(i, i + batchSize)
    outcomes.push(...(await enrichWords({ client, record, maxSenses }, batch)))
  }
  let failed = 0
  for (const o of outcomes) {
    if (!o.entry) failed++
    console.log(
      `\n=== ${o.input}: ${o.entry ? `${o.entry.senses.length} senses  UK ${o.entry.ipaUk}  US ${o.entry.ipaUs}` : 'FAILED'}`
    )
    o.entry?.senses.forEach((s, i) => {
      console.log(`  ${i + 1}. [${s.pos} | ${s.register}] ${s.defEn}  —  ${s.defZh}`)
      console.log(`     synonyms: ${s.synonyms.join(', ') || '—'}`)
      console.log(`     ${s.exampleEn}   ⟨${s.cloze.join(' … ')}⟩`)
      console.log(`     ${s.exampleZh}`)
    })
    if (o.problems.length > 0) console.log('  validator problems:', o.problems)
  }

  type TokenKey = 'promptTokens' | 'completionTokens' | 'cacheHitTokens' | 'reasoningTokens'
  const sum = (key: TokenKey, kinds?: LlmCallRecord['kind'][]): number =>
    calls.filter((c) => !kinds || kinds.includes(c.kind)).reduce((n, c) => n + (c[key] ?? 0), 0)
  console.log(
    `\n${calls.length} calls (${calls.filter((c) => c.kind === 'repair').length} repairs, ${calls.filter((c) => !c.ok).length} not ok), ` +
      `${failed}/${enrichList.length} words failed, ${((Date.now() - started) / 1000).toFixed(1)}s for generation; ` +
      `tokens in ${sum('promptTokens')} (cache hit ${sum('cacheHitTokens')}), out ${sum('completionTokens')} ` +
      `(reasoning ${sum('reasoningTokens')})`
  )
  const generated = outcomes.filter((o) => o.entry)
  const senses = generated.reduce((n, o) => n + (o.entry?.senses.length ?? 0), 0)
  console.log(
    `generation: ${Math.round(sum('completionTokens', ['enrich', 'repair']) / enrichList.length)} output tokens per word, ` +
      `${(senses / Math.max(1, generated.length)).toFixed(2)} senses per word`
  )
  if (failed > 0) process.exitCode = 1
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
