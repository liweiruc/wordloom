// The study data both end-to-end runs start from (scripts/e2e-smoke.ts for the Windows app,
// scripts/e2e-web.ts for the web app): the sample word list with synthetic entries, about six
// weeks of study done with the real scheduler, and a few real entries new today.
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import { openDatabase, type DB } from '../src/main/db/connection'
import { DEFAULT_SETTINGS } from '../src/main/db/settings'
import { commitImport } from '../src/main/import/commit'
import { parseDictExport, splitLines } from '../src/main/import/parsers'
import { saveEnrichment } from '../src/main/library/words'
import type { EntryDraft } from '../src/main/llm/validate'
import { saveLookup } from '../src/main/lookup/lookup'
import { buildDailyQueue } from '../src/main/srs/queue'
import { makeScheduler } from '../src/main/srs/scheduler'
import { StudySession } from '../src/main/srs/session'
import { decodeText } from '../src/shared/decode'

const root = resolve(__dirname, '..')

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

/**
 * Entries as a chat would write them, for the runs to import as an entries file: "drizzle", new,
 * with a third sense that gives the word away (left out, and listed as a problem), and the
 * seed's pending "serendipity", which takes its entry instead of waiting for the generator.
 */
export const CHAT_ENTRIES = {
  drizzle: {
    input: 'drizzle',
    ipa_uk: '/ˈdrɪz.əl/',
    ipa_us: '/ˈdrɪz.əl/',
    senses: [
      {
        pos: 'n.',
        def_en: 'light rain falling in very small drops',
        def_zh: '毛毛雨；细雨',
        synonyms: ['mist', 'sprinkle'],
        register: 'neutral',
        example_en: 'The drizzle kept falling all afternoon, so we stayed inside.',
        example_zh: '毛毛雨下了一下午，我们就待在屋里。',
        cloze: ['drizzle']
      },
      {
        pos: 'v.',
        def_en: 'to pour a thin stream of liquid over food',
        def_zh: '（在食物上）淋，洒',
        synonyms: ['trickle'],
        register: 'neutral',
        example_en: 'Drizzle a little olive oil over the salad before serving.',
        example_zh: '上菜前在沙拉上淋一点橄榄油。',
        cloze: ['Drizzle']
      },
      {
        pos: 'v.',
        def_en: 'to drizzle lightly',
        def_zh: '下毛毛雨',
        synonyms: [],
        register: 'neutral',
        example_en: 'It started to drizzle as we left the house.',
        example_zh: '我们出门的时候开始下毛毛雨了。',
        cloze: ['drizzle']
      }
    ]
  },
  serendipity: {
    input: 'serendipity',
    ipa_uk: '/ˌser.ənˈdɪp.ə.ti/',
    ipa_us: '/ˌser.ənˈdɪp.ə.ti/',
    senses: [
      {
        pos: 'n.',
        def_en: 'finding something good by chance, without looking for it',
        def_zh: '机缘巧合；意外发现好东西的运气',
        synonyms: ['luck', 'chance', 'fluke'],
        register: 'neutral',
        example_en: 'We met by pure serendipity in a little bookshop in Paris.',
        example_zh: '我们纯属机缘巧合，在巴黎一家小书店里相遇。',
        cloze: ['serendipity']
      }
    ]
  }
}

/** A reply copied out of a chat: a sentence, then the entries in a ```json fence. */
export function chatReply(entries: unknown[]): string {
  return `Here are the entries:\n\`\`\`json\n${JSON.stringify({ entries })}\n\`\`\``
}

/** Writes the seeded database to file (a Windows-style database: WAL mode). */
export function seed(file: string): void {
  const db = openDatabase(file)
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
