// End-to-end run of the web app (`npm run build:web` first):
//   npm run e2e:web -- [screenshot-dir]
// Serves dist-web under /wordloom/, as GitHub Pages does, and drives it in Microsoft Edge at
// iPad sizes: restores a database written the way the Windows app writes it through 设置 →
// 从文件恢复, studies, imports a GBK file, looks a word up, backs up and restores, exports,
// reloads offline, opens a second tab, and checks that the API key never reaches an export.
/// <reference lib="dom" />
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import iconv from 'iconv-lite'
import { chromium, type Page } from 'playwright-core'
import { preview } from 'vite'
import { openDatabase } from '../src/main/db/connection'
import type { WordloomApi } from '../src/shared/api'
import { seed } from './e2e-seed'

// The API the web app's bridge puts on window. page.evaluate callbacks run inside the page,
// so each one reaches it through window itself; only this type crosses over.
type Bridge = { api: WordloomApi }

const root = resolve(__dirname, '..')
const shots = resolve(process.argv[2] ?? join(root, 'out', 'e2e-web'))
mkdirSync(shots, { recursive: true })

// An 11-inch iPad Air, both ways round.
const LANDSCAPE = { width: 1180, height: 820 }
const PORTRAIT = { width: 820, height: 1180 }

const failures: string[] = []
function check(ok: boolean, failure: string): void {
  if (!ok) failures.push(failure)
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(shots, `${name}.png`) })
  console.log('screenshot', name)
}

function countWords(file: string): number {
  const db = openDatabase(file)
  const { n } = db.prepare('SELECT count(*) AS n FROM words').get() as { n: number }
  db.close()
  return n
}

async function wordTotal(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const api = (window as unknown as Bridge).api
    return (await api.words.list({ limit: 1 })).total
  })
}

// After a restore the worker swaps the database in, then has the page reload.
async function reloadAfter(page: Page, action: () => Promise<unknown>): Promise<void> {
  await Promise.all([page.waitForEvent('load', { timeout: 30_000 }), action()])
}

async function download(page: Page, button: string | RegExp): Promise<[string, Buffer]> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: button }).click()
  ])
  return [file.suggestedFilename(), readFileSync(await file.path())]
}

async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'wordloom-e2e-web-'))
  // What someone moving to the iPad brings along: a database from the Windows app.
  const seeded = join(work, 'wordloom-seeded.db')
  seed(seeded)
  const seededWords = countWords(seeded)
  console.log('seeded', seededWords, 'words in', seeded)

  const server = await preview({
    configFile: join(root, 'vite.web.config.mts'),
    base: '/wordloom/',
    logLevel: 'warn'
  })
  const url = server.resolvedUrls!.local[0]
  const browser = await chromium.launch({ channel: 'msedge' })
  const context = await browser.newContext({ viewport: LANDSCAPE })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('dialog', (dialog) => void dialog.accept())

  try {
    console.log('open', url)
    await page.goto(url)
    // The app opens on 查词.
    await page.getByLabel('要查的词').waitFor()
    await page.getByRole('link', { name: '设置' }).click()
    await page.waitForSelector('text=DeepSeek')
    await shot(page, '01-settings-empty')

    // ---- move in: the Windows database through 从文件恢复 ----
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: '从文件恢复…' }).click()
    ])
    await reloadAfter(page, () => chooser.setFiles(seeded))
    check((await wordTotal(page)) === seededWords, 'the restored database lacks words')
    await page.getByRole('link', { name: '复习', exact: true }).click()
    await page.waitForSelector('text=/开始学习|继续学习/')
    await shot(page, '02-today')

    // ---- study a few cards ----
    await page.getByRole('button', { name: /开始学习|继续学习/ }).click()
    await page.waitForFunction(
      () =>
        document.body.innerText.includes('记住了，开始测试') ||
        document.querySelector('input[aria-label="答案"]') !== null
    )
    let answered = 0
    for (let guard = 0; answered < 3 && guard < 10; guard++) {
      const step = await page.evaluate(() => (window as unknown as Bridge).api.study.current())
      if (!step || step.kind === 'done') break
      if (step.kind === 'intro') {
        await page.waitForSelector('text=记住了，开始测试')
        await page.keyboard.press('Enter')
        await page.waitForTimeout(150)
        continue
      }
      if (answered === 0) await shot(page, '03-cloze')
      await page.getByLabel('答案').fill(step.card.example.cloze.join(' '))
      await page.keyboard.press('Enter')
      await page.waitForSelector('text=建议 · Enter')
      if (answered === 0) await shot(page, '04-verdict')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(150)
      answered++
    }
    check(answered === 3, `answered ${answered} cards, expected 3`)
    await page.getByRole('button', { name: /结束/ }).click()
    await page.getByRole('link', { name: '导入' }).waitFor()

    // ---- import a GBK file through 选择文件 ----
    const gbk = join(work, 'gbk-words.txt')
    writeFileSync(
      gbk,
      iconv.encode(
        '1, thresholds    英译中\nn.阈值\n20261025\n2, harass    英译中\nv.骚扰\n',
        'gbk'
      )
    )
    await page.getByRole('link', { name: '导入' }).click()
    const [picker] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: '选择文件' }).click()
    ])
    await picker.setFiles(gbk)
    await page.waitForSelector('text=导入预览')
    check((await page.getByText('GB18030').count()) > 0, 'the GBK file was not read as GB18030')
    await shot(page, '05-import-gbk')

    // ---- lookup: a library word, so no model is needed ----
    await page.getByRole('link', { name: '查词' }).click()
    const box = page.getByLabel('要查的词')
    await box.fill('wiggle')
    await box.press('Enter')
    await page.getByRole('heading', { name: 'wiggle', exact: true }).waitFor()
    await page.waitForSelector('text=已在词库')
    await shot(page, '06-lookup')

    // ---- library and statistics, then every page in portrait ----
    await page.getByRole('link', { name: '词库' }).click()
    await page.waitForSelector('text=义项进度')
    await shot(page, '07-library')
    await page.getByRole('link', { name: '统计' }).click()
    await page.waitForSelector('text=学习日历')
    await page.waitForTimeout(600)
    await shot(page, '08-stats')
    await page.setViewportSize(PORTRAIT)
    const pages: [string, string, string][] = [
      ['复习', 'text=/开始学习|继续学习|今天已复习/', '09-portrait-today'],
      ['词库', 'text=义项进度', '10-portrait-library'],
      ['统计', 'text=学习日历', '11-portrait-stats'],
      ['设置', 'text=DeepSeek', '12-portrait-settings']
    ]
    for (const [link, ready, name] of pages) {
      await page.getByRole('link', { name: link, exact: true }).click()
      await page.waitForSelector(ready)
      await shot(page, name)
    }
    await page.setViewportSize(LANDSCAPE)

    // ---- back up, then restore that backup from the list ----
    await page.getByRole('button', { name: '立即备份' }).click()
    await page.waitForSelector('text=已备份')
    const backups = await page.evaluate(() => (window as unknown as Bridge).api.data.listBackups())
    console.log('backups:', backups.map((b) => b.name).join(', '))
    check(
      backups.some((b) => b.name.startsWith('pre-restore-')),
      'no backup was made before the restore'
    )
    await shot(page, '13-backups')
    const row = page.getByText(backups[0].name, { exact: true }).locator('..')
    await reloadAfter(page, () => row.getByRole('button', { name: '恢复' }).click())
    check((await wordTotal(page)) === seededWords, 'restoring the backup lost words')

    // ---- export: a database file, as the Windows app's 从文件恢复 takes it, and JSON ----
    const [dbName, dbBytes] = await download(page, '导出数据库文件')
    check(/^wordloom-\d{4}-\d{2}-\d{2}\.db$/.test(dbName), `export named ${dbName}`)
    check(
      dbBytes.subarray(0, 16).toString('latin1') === 'SQLite format 3\0',
      'the exported file is not a SQLite database'
    )
    const exported = join(work, 'exported.db')
    writeFileSync(exported, dbBytes)
    check(countWords(exported) === seededWords, 'the exported database lacks words')
    const [, json] = await download(page, /导出 JSON/)
    check(json.toString('utf8').includes('"wiggle"'), 'the JSON export lacks words')

    // ---- offline: the service worker serves the whole app ----
    check(
      await page.evaluate(() => navigator.serviceWorker.controller !== null),
      'the page is not controlled by the service worker'
    )
    await context.setOffline(true)
    await page.reload()
    await page.getByRole('link', { name: '词库' }).click()
    await page.waitForSelector('text=义项进度')
    check((await wordTotal(page)) === seededWords, 'offline, the library lacks words')
    await shot(page, '14-offline-library')
    await context.setOffline(false)

    // ---- a second tab gets a message, and leaves the data alone ----
    const second = await context.newPage()
    await second.goto(url)
    await second.waitForSelector('text=打不开这台设备上的数据', { timeout: 20_000 })
    await shot(second, '15-second-tab')
    await second.close()
    await page.reload()
    check((await wordTotal(page)) === seededWords, 'after the second tab, the library lacks words')

    // ---- the API key survives a reload but never reaches an export ----
    const seenErrors = [...errors]
    const FAKE_KEY = 'sk-e2e-not-a-real-key'
    await page.evaluate(async (key) => {
      const api = (window as unknown as Bridge).api
      // A dead local address, so the fake key never travels anywhere.
      await api.settings.update({ llm: { baseUrl: 'https://127.0.0.1:9' } })
      await api.settings.setApiKey(key)
    }, FAKE_KEY)
    await page.reload()
    const view = await page.evaluate(() => (window as unknown as Bridge).api.settings.get())
    check(view.hasApiKey, 'the API key was lost on reload')
    check(view.storage.kind === 'browser', `storage is ${JSON.stringify(view.storage)}`)
    await page.getByRole('link', { name: '设置' }).click()
    const [, keyed] = await download(page, '导出数据库文件')
    check(!keyed.includes(FAKE_KEY), 'the API key is in the exported database')

    for (const err of seenErrors) failures.push(`page error: ${err}`)
  } finally {
    await browser.close()
    await server.close()
  }
  if (failures.length > 0) {
    console.error('FAILED:\n' + failures.join('\n'))
    process.exitCode = 1
  } else {
    console.log('all checks passed')
  }
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
