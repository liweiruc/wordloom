// End-to-end smoke run of the built app (`npm run build` first):
//   npx tsx scripts/e2e-smoke.ts [screenshot-dir]
// Seeds a throwaway data folder from the sample word list, simulates ~40 days of study
// with the real scheduler, then drives the Electron app through import, study, library,
// word detail, lookup, statistics and settings, saving a screenshot of each.
/// <reference lib="dom" />
import { mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { _electron as electron, type Page } from 'playwright-core'
import { openDatabase } from '../src/main/db/connection'
import type { WordloomApi } from '../src/shared/api'
import { seed } from './e2e-seed'

// The renderer's preload bridge. page.evaluate callbacks run inside the page, so each one
// reaches it through window itself; only this type crosses over.
type Bridge = { api: WordloomApi }

const root = resolve(__dirname, '..')
const shots = resolve(process.argv[2] ?? join(root, 'out', 'e2e'))
mkdirSync(shots, { recursive: true })

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(shots, `${name}.png`) })
  console.log('screenshot', name)
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'wordloom-e2e-'))
  seed(join(dataDir, 'wordloom.db'))
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

  // ---- export the database, the file that moves the data to the iPad ----
  // Electron asks where to save a download unless the main process names a path first.
  const exportDir = mkdtempSync(join(tmpdir(), 'wordloom-e2e-export-'))
  await app.evaluate(({ session }, dir) => {
    const saved = new Promise<string>((resolve) =>
      session.defaultSession.once('will-download', (_e, item) => {
        item.setSavePath(`${dir}\\${item.getFilename()}`)
        item.once('done', () => resolve(item.getSavePath()))
      })
    )
    Object.assign(globalThis, { saved })
  }, exportDir)
  await page.getByRole('button', { name: '导出数据库文件' }).click()
  const exported = await app.evaluate(
    () => (globalThis as unknown as { saved: Promise<string> }).saved
  )
  const copy = openDatabase(exported)
  const exportedWords = (copy.prepare('SELECT count(*) AS n FROM words').get() as { n: number }).n
  copy.close()
  if (!/wordloom-\d{4}-\d{2}-\d{2}\.db$/.test(exported) || exportedWords === 0) {
    errors.push(`database export: ${exported} with ${exportedWords} words`)
  } else {
    console.log('database exported with', exportedWords, 'words')
  }

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
