// End-to-end smoke run of the built app (`npm run build` first):
//   npx tsx scripts/e2e-smoke.ts [screenshot-dir]
// Seeds a throwaway data folder from the sample word list, simulates ~40 days of study
// with the real scheduler, then drives the Electron app through import, study, library,
// word detail, lookup, statistics and settings, saving a screenshot of each.
/// <reference lib="dom" />
import { mkdirSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { _electron as electron, type Page } from 'playwright-core'
import { openDatabase, type DB } from '../src/main/db/connection'
import { DEFAULT_SETTINGS } from '../src/main/db/settings'
import { commitImport } from '../src/main/import/commit'
import { decodeText } from '../src/main/import/decode'
import { parseDictExport, splitLines } from '../src/main/import/parsers'
import { saveEnrichment } from '../src/main/library/words'
import type { EntryDraft } from '../src/main/llm/validate'
import { saveLookup } from '../src/main/lookup/lookup'
import { buildDailyQueue } from '../src/main/srs/queue'
import { makeScheduler } from '../src/main/srs/scheduler'
import { StudySession } from '../src/main/srs/session'
import type { WordloomApi } from '../src/shared/api'

// The renderer's preload bridge. page.evaluate callbacks run inside the page, so each one
// reaches it through window itself; only this type crosses over.
type Bridge = { api: WordloomApi }

const root = resolve(__dirname, '..')
const shots = resolve(process.argv[2] ?? join(root, 'out', 'e2e'))
mkdirSync(shots, { recursive: true })

function wordId(db: DB, headword: string): number {
  return (
    db.prepare('SELECT id FROM words WHERE norm = ?').get(headword.toLowerCase()) as { id: number }
  ).id
}

function synthetic(headword: string, senses: number): EntryDraft {
  return {
    headword,
    ipaUk: '/ˈsæm.pəl/',
    ipaUs: '/ˈsæm.pəl/',
    variants: [],
    senses: Array.from({ length: senses }, (_, i) => ({
      pos: i === 0 ? 'n.' : 'v.',
      defEn: `a placeholder meaning number ${i + 1} used for testing`,
      defZh: '测试用释义',
      synonyms: i === 0 ? ['stand-in', 'dummy'] : [],
      register: 'neutral' as const,
      exampleEn: `We wrote ${headword} on the board today.`,
      exampleZh: '测试例句。',
      cloze: [headword]
    }))
  }
}

const REAL: Record<string, EntryDraft> = {
  wiggle: {
    headword: 'wiggle',
    ipaUk: '/ˈwɪɡ.əl/',
    ipaUs: '/ˈwɪɡ.əl/',
    variants: [],
    senses: [
      {
        pos: 'v.',
        defEn: 'to move with small quick movements from side to side',
        defZh: '扭动；摆动',
        synonyms: ['squirm', 'twist'],
        register: 'neutral',
        exampleEn: 'The baby giggled and tried to wiggle out of her jacket.',
        exampleZh: '宝宝咯咯笑着，想扭动着从外套里钻出来。',
        cloze: ['wiggle']
      },
      {
        pos: 'n.',
        defEn: 'a small quick movement from side to side',
        defZh: '扭动；摆动',
        synonyms: [],
        register: 'neutral',
        exampleEn: 'She gave her hips a little wiggle and started dancing.',
        exampleZh: '她轻轻扭了扭腰，跳起舞来。',
        cloze: ['wiggle']
      }
    ]
  },
  'rip off': {
    headword: 'rip off',
    ipaUk: '/ˌrɪp ˈɒf/',
    ipaUs: '/ˌrɪp ˈɑːf/',
    variants: [],
    senses: [
      {
        pos: 'phr. v.',
        defEn: 'to cheat someone by making them pay too much',
        defZh: '敲竹杠；宰（客）',
        synonyms: ['swindle', 'overcharge', 'con'],
        register: 'informal',
        exampleEn: 'That taxi driver totally ripped us off. It should have cost half that.',
        exampleZh: '那个出租车司机把我们狠狠宰了一顿，本来只要一半的钱。',
        cloze: ['ripped', 'off']
      }
    ]
  },
  wrinkle: {
    headword: 'wrinkle',
    ipaUk: '/ˈrɪŋ.kəl/',
    ipaUs: '/ˈrɪŋ.kəl/',
    variants: [],
    senses: [
      {
        pos: 'n.',
        defEn: 'a small line in the skin that appears as people get older',
        defZh: '皱纹',
        synonyms: ['crease', 'line'],
        register: 'neutral',
        exampleEn: 'My grandma laughs so much that she has deep wrinkles around her eyes.',
        exampleZh: '我奶奶特别爱笑，眼角都有了很深的皱纹。',
        cloze: ['wrinkles']
      }
    ]
  }
}

function seed(dataDir: string): void {
  const db = openDatabase(join(dataDir, 'wordloom.db'))
  const sample = decodeText(readFileSync(join(root, 'tests/fixtures/20261025.txt'))).text
  const headwords = parseDictExport(splitLines(sample))
    .map((c) => c.headword)
    .filter((h) => !(h in REAL))
    .slice(0, 90)
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 42, 9).getTime()
  commitImport(
    db,
    {
      listName: '20261025',
      sourceFile: '20261025.txt',
      items: headwords.map((headword) => ({ headword }))
    },
    start
  )
  headwords.forEach((h, i) =>
    saveEnrichment(db, wordId(db, h), synthetic(h, 1 + (i % 3)), {
      model: 'seed',
      promptVersion: 1,
      maxSenses: 4,
      now: start
    })
  )

  // Six weeks of study with the real queue and session: about 85% answered right, the odd
  // day skipped, the last week unbroken so there is a streak.
  const study = { ...DEFAULT_SETTINGS.study, newPerDay: 10 }
  let rand = 7
  const random = (): number => (rand = (rand * 16807) % 2147483647) / 2147483647
  for (let back = 41; back >= 1; back--) {
    if (back > 7 && random() < 0.2) continue
    let now = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back, 20).getTime()
    const scheduler = makeScheduler(study)
    const session = new StudySession(
      { db, scheduler, settings: study, now: () => now },
      buildDailyQueue(db, scheduler, study, now).entries
    )
    for (let step = session.step(); step.kind !== 'done'; step = session.step()) {
      if (step.kind === 'intro') {
        session.continueIntro()
        continue
      }
      now += 15_000 + random() * 45_000
      const right = random() < 0.85
      session.answer({
        cardId: step.card.cardId,
        input: right ? step.card.example.cloze.join(' ') : 'nope',
        hintsUsed: 0,
        durationMs: 6_000 + random() * 14_000,
        gaveUp: false
      })
      session.rate(right ? (random() < 0.15 ? 4 : 3) : 1)
    }
  }

  // Real entries, new today, for the live session.
  commitImport(db, {
    listName: '示例',
    sourceFile: null,
    items: Object.keys(REAL).map((headword) => ({ headword }))
  })
  for (const [h, draft] of Object.entries(REAL)) {
    saveEnrichment(db, wordId(db, h), draft, {
      model: 'seed',
      promptVersion: 1,
      maxSenses: 4,
      now: Date.now()
    })
  }
  // A pending word, so the generation notice and sidebar status show up too.
  commitImport(db, { listName: '示例', sourceFile: null, items: [{ headword: 'serendipity' }] })
  // A word looked up before, whose saved entry 查词 can show and add without a key.
  saveLookup(db, synthetic('wanderlust', 2), 'seed')
  db.close()
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(shots, `${name}.png`) })
  console.log('screenshot', name)
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'wordloom-e2e-'))
  seed(dataDir)
  console.log('data dir', dataDir)

  // E2E_EXECUTABLE runs the same checks against a packaged build, e.g. dist/win-unpacked/Wordloom.exe.
  const executable = process.env['E2E_EXECUTABLE']
  const env = { ...process.env, WORDLOOM_DATA_DIR: dataDir }
  const app = await electron.launch(
    executable
      ? { executablePath: executable, args: [], env }
      : { args: [join(root, 'out', 'main', 'index.js')], env }
  )
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  await page.waitForSelector('text=复习')
  await shot(page, '01-today')

  // ---- study: intro, blank, wrong form, rating, undo ----
  await page.getByRole('button', { name: /开始学习|继续学习/ }).click()
  // Due reviews and new cards are interleaved, so either kind of card can come first.
  await page.waitForFunction(
    () =>
      document.body.innerText.includes('记住了，开始测试') ||
      document.querySelector('input[aria-label="答案"]') !== null
  )
  let seen = 0
  let introShown = false
  for (let guard = 0; guard < 60; guard++) {
    const step = await page.evaluate(() => (window as unknown as Bridge).api.study.current())
    if (!step || step.kind === 'done') break
    if (step.kind === 'intro') {
      await page.waitForSelector('text=记住了，开始测试')
      if (!introShown) await shot(page, '02-intro')
      introShown = true
      await page.keyboard.press('Enter')
      await page.waitForTimeout(150)
      continue
    }
    const answer = step.card.example.cloze.join(' ')
    if (seen === 0) await shot(page, '03-cloze')
    const typed = seen === 1 ? step.card.headword : seen === 2 ? answer.slice(0, -1) + 'x' : answer
    await page.getByLabel('答案').fill(typed)
    if (seen === 0) {
      await page.keyboard.press('Control+h')
      await page.keyboard.press('Control+h')
      await shot(page, '04-hints')
    }
    await page.keyboard.press('Enter')
    await page.waitForSelector('text=建议 · Enter')
    if (seen < 3) await shot(page, `05-verdict-${seen}`)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    if (seen === 1) {
      await page.keyboard.press('Control+z')
      await page.waitForTimeout(200)
      await shot(page, '06-after-undo')
    }
    seen++
  }
  await page.waitForSelector('text=返回复习', { timeout: 10_000 })
  await shot(page, '07-done')
  await page.getByRole('button', { name: '返回复习' }).click()
  await page.waitForSelector('text=今天已复习')
  await shot(page, '08-today-after')

  // ---- import: paste a dictionary-export snippet, preview it, commit ----
  await page.getByRole('link', { name: '导入' }).click()
  await page
    .getByPlaceholder(/每行一个单词/)
    .fill(
      '1, thresholds    英译中\nn.阈值\n20261025\n2, harrass    英译中\nv.骚扰\n20261025\n3, Jerusalem    英译中\n耶路撒冷\n20261025\n4, self esteem  [ˌself ɪˈstiːm]  英译中\n自尊\n20261025'
    )
  await page.getByRole('button', { name: '解析' }).click()
  await page.waitForSelector('text=导入预览')
  await shot(page, '09-import-preview')
  await page.getByRole('button', { name: /^导入 \d+ 个词$/ }).click()
  await page.waitForSelector('text=已导入到')
  await shot(page, '10-import-done')

  // ---- library, word detail ----
  await page.getByRole('link', { name: '词库' }).click()
  await page.waitForSelector('text=义项进度')
  await shot(page, '11-library')
  const studied = await page.evaluate(async () => {
    const list = await (window as unknown as Bridge).api.words.list({ sort: 'due', limit: 50 })
    return list.items.find((w) => w.reviewedCards > 0 && w.senseCount > 1)?.id ?? list.items[0].id
  })
  await page.evaluate((id) => (location.hash = `#/words/${id}`), studied)
  await page.waitForSelector('text=复习记录')
  await shot(page, '12-word-detail')
  await page.evaluate(() =>
    [...document.querySelectorAll('h2')]
      .find((h) => h.textContent === '遗忘曲线')
      ?.scrollIntoView({ block: 'start' })
  )
  await page.waitForTimeout(500)
  await shot(page, '12b-word-curve')

  // ---- lookup: a library word, then a saved entry added to 生词本; no model needed ----
  await page.getByRole('link', { name: '查词' }).click()
  const box = page.getByLabel('要查的词')
  await box.fill('wiggle')
  await box.press('Enter')
  await page.getByRole('heading', { name: 'wiggle', exact: true }).waitFor()
  await page.waitForSelector('text=已在词库')
  await shot(page, '19-lookup-library')
  await box.fill('wanderlust')
  await box.press('Enter')
  await page.getByRole('heading', { name: 'wanderlust', exact: true }).waitFor()
  await page.getByRole('button', { name: '加入生词本', exact: true }).click()
  await page.waitForSelector('text=已在生词本')
  await shot(page, '20-lookup-added')
  await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 99999))
  await shot(page, '20b-lookup-history')
  const added = await page.evaluate(async () => {
    const api = (window as unknown as Bridge).api
    const list = (await api.lists.all()).find((l) => l.name === '生词本')
    const page = await api.words.list({ listId: list?.id, search: 'wanderlust' })
    return page.items[0] ?? null
  })
  if (added?.status !== 'ready' || added.senseCount !== 2) {
    errors.push(`wanderlust not added to 生词本 as a ready word: ${JSON.stringify(added)}`)
  } else {
    console.log('lookup added to 生词本 with its saved entry')
  }

  // ---- statistics, settings ----
  await page.getByRole('link', { name: '统计' }).click()
  await page.waitForSelector('text=学习日历')
  await page.waitForTimeout(600)
  await shot(page, '13-stats')
  await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 99999))
  await shot(page, '14-stats-bottom')
  await page.getByRole('link', { name: '设置' }).click()
  await page.waitForSelector('text=DeepSeek')
  await shot(page, '15-settings')

  // ---- dark theme: its own token set, checked by eye ----
  // Playwright pins prefers-color-scheme to light unless told otherwise.
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByRole('link', { name: '统计' }).click()
  await page.waitForSelector('text=学习日历')
  await page.waitForTimeout(800)
  await shot(page, '16-dark-stats')
  await page.getByRole('link', { name: '复习', exact: true }).click()
  await page.waitForSelector('text=今天已复习')
  await shot(page, '17-dark-today')
  // Everything due today was studied above, so only a word imported since has a card left.
  const start = page.getByRole('button', { name: /开始学习|继续学习/ })
  if ((await start.count()) > 0) {
    await start.click()
    await page.waitForFunction(
      () =>
        document.body.innerText.includes('记住了，开始测试') ||
        document.querySelector('input[aria-label="答案"]') !== null
    )
    await shot(page, '18-dark-study')
  }

  // ---- the API key must reach the disk encrypted ----
  // A dead local port as base URL, so the fake key never travels anywhere.
  const FAKE_KEY = 'sk-e2e-not-a-real-key'
  await page.evaluate(async (key) => {
    const api = (window as unknown as Bridge).api
    await api.settings.update({ llm: { baseUrl: 'http://127.0.0.1:9' } })
    await api.settings.setApiKey(key)
  }, FAKE_KEY)

  await app.close()
  const check = openDatabase(join(dataDir, 'wordloom.db'))
  const stored = (
    check.prepare("SELECT value FROM settings WHERE key = 'secret.llmApiKey'").get() as
      { value: string } | undefined
  )?.value
  check.close()
  if (!stored?.startsWith('dpapi:') || stored.includes(FAKE_KEY)) {
    errors.push(`API key not stored DPAPI-encrypted: ${stored?.slice(0, 12)}…`)
  } else {
    console.log('api key stored encrypted (dpapi)')
  }
  if (errors.length > 0) {
    console.error('renderer errors:\n' + errors.join('\n'))
    process.exitCode = 1
  } else {
    console.log('no renderer errors')
  }
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
