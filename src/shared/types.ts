// Everything here crosses the IPC boundary, so it is plain JSON: timestamps are epoch
// milliseconds, never Date objects.

export type WordStatus = 'pending' | 'enriching' | 'ready' | 'failed'
export type WordKind = 'word' | 'phrase' | 'proper_noun'
export type Register = 'neutral' | 'formal' | 'informal' | 'slang'
export type ChineseDisplay = 'always' | 'tap' | 'never'

/** Same numbering as ts-fsrs `Rating`: 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type Grade = 1 | 2 | 3 | 4
/** Same numbering as ts-fsrs `State`. */
export type CardState = 0 | 1 | 2 | 3

export const GRADES: readonly Grade[] = [1, 2, 3, 4]
export const GRADE_LABEL: Record<Grade, string> = { 1: '重来', 2: '困难', 3: '良好', 4: '简单' }
export const CARD_STATE_LABEL: Record<CardState, string> = {
  0: '新卡',
  1: '学习中',
  2: '复习中',
  3: '重学中'
}
export const REGISTER_LABEL: Record<Register, string> = {
  neutral: '中性',
  formal: '正式',
  informal: '非正式',
  slang: '俚语'
}

/** How an answer was judged. `known` is "I already know this" on a new card. */
export type Outcome = 'correct' | 'typo' | 'wrong_form' | 'wrong' | 'gave_up' | 'known'

/** A card counts as mastered once its stability reaches this many days. */
export const MATURE_DAYS = 21

// ---------- settings ----------

export interface LlmSettings {
  baseUrl: string
  model: string
  batchSize: number
  concurrency: number
  maxSenses: number
  smartCleanup: boolean
}

export interface StudySettings {
  newPerDay: number
  reviewsPerDay: number
  retention: number
  learningSteps: string[]
  relearningSteps: string[]
  maxIntervalDays: number
  dayStartHour: number
  newOrder: 'primary-first' | 'by-word'
}

export interface DisplaySettings {
  chineseDisplay: ChineseDisplay
  autoSpeak: boolean
  voice: string
  speechRate: number
}

export interface DataSettings {
  backupKeep: number
}

export interface AppSettings {
  llm: LlmSettings
  study: StudySettings
  display: DisplaySettings
  data: DataSettings
}

export type SettingsPatch = { [K in keyof AppSettings]?: Partial<AppSettings[K]> }

export interface SettingsView {
  settings: AppSettings
  hasApiKey: boolean
  storage: StorageInfo
}

/** Where the database lives: a folder on Windows, the browser's own storage on the iPad. */
export type StorageInfo = { kind: 'folder'; path: string } | { kind: 'browser' }

// ---------- import ----------

export type ImportFormat = 'dictExport' | 'lineList' | 'freeText' | 'entries'

/** The formats a text source can be read in. An entries file is known by its content alone. */
export type TextFormat = Exclude<ImportFormat, 'entries'>

export interface ImportSource {
  name: string
  text: string
  encoding: string
}

/** The entry an entries file gives a word, as the generation checks found it. */
export interface FileEntry {
  /** The senses that passed, at most maxSenses of them; null when none did. */
  entry: EntryDraft | null
  /** How many senses the file gives. */
  given: number
  /** What the checks found wrong, worded as they word it for the model, and senses over the limit. */
  problems: string[]
}

export interface PreviewCandidate {
  headword: string
  norm: string
  /**
   * 1-based line of the first occurrence, in the source it came from; in an entries file, the
   * item's position.
   */
  line: number
  source: string
  occurrences: number
  existingWordId: number | null
  existingStatus: WordStatus | null
  fileEntry: FileEntry | null
}

export interface ParsePreview {
  format: ImportFormat
  detected: ImportFormat
  sources: { name: string; encoding: string; lines: number; format: ImportFormat }[]
  candidates: PreviewCandidate[]
  /** Items of entries files that were left out, and why. */
  skipped: string[]
}

export type TriageKind =
  'ok' | 'inflection' | 'misspelling' | 'variant' | 'proper_noun' | 'not_english'

export interface TriageItem {
  input: string
  kind: TriageKind
  suggestion: string
  keepSeparate: boolean
  note: string
}

export interface CommitItem {
  headword: string
  kind?: WordKind
  /** From an entries file: saved as it is, so the word is never generated. */
  entry?: EntryDraft
}

export interface CommitRequest {
  listName: string
  sourceFile: string | null
  items: CommitItem[]
}

export interface CommitResult {
  listId: number
  created: number
  linked: number
  /** Words, new or still waiting for an entry, that were saved with the file's entry. */
  filled: number
  /** New words left to the generator. */
  queued: number
}

// ---------- enrichment ----------

// A generated entry once it has passed the checks. A looked-up word's entry crosses IPC as one.
export interface SenseDraft {
  pos: string
  defEn: string
  defZh: string
  synonyms: string[]
  register: Register
  exampleEn: string
  exampleZh: string
  cloze: string[]
}

export interface EntryDraft {
  headword: string
  ipaUk: string
  ipaUs: string
  variants: string[]
  senses: SenseDraft[]
}

export interface EnrichStatus {
  running: boolean
  paused: boolean
  hasApiKey: boolean
  pending: number
  enriching: number
  ready: number
  failed: number
  lastError: string | null
  /** Totals since the app started. */
  session: {
    done: number
    failed: number
    promptTokens: number
    completionTokens: number
    cacheHitTokens: number
  }
}

// ---------- library ----------

export interface WordQuery {
  search?: string
  listId?: number | null
  status?: WordStatus | 'all'
  sort?: 'recent' | 'alpha' | 'due'
  offset?: number
  limit?: number
}

export interface WordListItem {
  id: number
  headword: string
  ipaUs: string
  status: WordStatus
  error: string | null
  senseCount: number
  reviewedCards: number
  matureCards: number
  nextDue: number | null
  firstDef: string | null
  createdAt: number
}

export interface WordListPage {
  items: WordListItem[]
  total: number
}

export interface ExampleView {
  id: number
  en: string
  zh: string
  cloze: string[]
}

export interface CardView {
  id: number
  state: CardState
  due: number
  stability: number
  difficulty: number
  reps: number
  lapses: number
  lastReview: number | null
  suspended: boolean
  /** Predicted recall probability right now; null for cards never reviewed. */
  retrievability: number | null
}

export interface SenseView {
  id: number
  ord: number
  pos: string
  defEn: string
  defZh: string
  synonyms: string[]
  register: Register
  userEdited: boolean
  example: ExampleView | null
  card: CardView | null
}

export interface ReviewLogView {
  id: number
  cardId: number
  senseId: number
  reviewedAt: number
  rating: Grade
  outcome: Outcome
  answer: string
  hintsUsed: number
  durationMs: number
  stateBefore: CardState
  scheduledDays: number
  stability: number
}

export interface WordDetail {
  id: number
  headword: string
  norm: string
  kind: WordKind
  ipaUk: string
  ipaUs: string
  variants: string[]
  status: WordStatus
  error: string | null
  llmModel: string | null
  enrichedAt: number | null
  createdAt: number
  note: string
  lists: { id: number; name: string }[]
  senses: SenseView[]
  logs: ReviewLogView[]
}

export interface WordPatch {
  headword?: string
  ipaUk?: string
  ipaUs?: string
  note?: string
}

export interface SensePatch {
  pos?: string
  defEn?: string
  defZh?: string
  synonyms?: string[]
  register?: Register
  exampleEn?: string
  exampleZh?: string
  cloze?: string[]
}

export interface CurveData {
  cardId: number
  now: number
  retention: number
  /** Predicted recall over time: one segment per review, the last running into the future. */
  segments: { t: number; r: number }[][]
  reviews: { t: number; rating: Grade }[]
}

export interface ListSummary {
  id: number
  name: string
  sourceFile: string | null
  createdAt: number
  words: number
  ready: number
  failed: number
  cards: number
  studiedCards: number
  matureCards: number
}

// ---------- lookup ----------

/** The 词表 that looked-up words are added to; pasted text goes there too by default. */
export const DEFAULT_LIST_NAME = '生词本'

/** What the clean-up changed before looking a word up: "struck" was looked up as "strike". */
export interface LookupCorrection {
  input: string
  kind: TriageKind
  note: string
}

export interface LookupResult {
  headword: string
  ipaUk: string
  ipaUs: string
  variants: string[]
  senses: SenseDraft[]
  /** The library's entry, the one an earlier lookup saved, or one generated just now. */
  source: 'library' | 'saved' | 'generated'
  /** The library word, once there is one. */
  wordId: number | null
  /** The library word's status: it has senses only once it is ready. Null outside the library. */
  status: WordStatus | null
  inDefaultList: boolean
  correction: LookupCorrection | null
}

export interface LookupHistoryItem {
  id: number
  headword: string
  /** The first sense's Chinese definition, from the library or the saved entry. */
  gloss: string | null
  lookedUpAt: number
  wordId: number | null
  inDefaultList: boolean
}

// ---------- study ----------

export interface StudyCardContent {
  cardId: number
  wordId: number
  senseId: number
  headword: string
  ipaUk: string
  ipaUs: string
  pos: string
  register: Register
  defEn: string
  defZh: string
  synonyms: string[]
  example: { en: string; zh: string; cloze: string[] }
  otherSenses: { pos: string; defEn: string; defZh: string; synonyms: string[] }[]
  state: CardState
  /** No other sense of this word has been studied yet, so the intro shows the whole word. */
  firstSenseOfWord: boolean
}

export interface StudyProgress {
  done: number
  remaining: number
  newLeft: number
  reviewLeft: number
  learningLeft: number
}

export interface SessionSummary {
  reviewed: number
  correct: number
  newLearned: number
  again: number
  durationMs: number
  /** Learning cards that come due later today, after this session. */
  learningLater: number
  troubleWords: { wordId: number; headword: string }[]
}

export type StudyStep =
  | { kind: 'intro'; card: StudyCardContent; progress: StudyProgress; canUndo: boolean }
  | { kind: 'cloze'; card: StudyCardContent; progress: StudyProgress; canUndo: boolean }
  | { kind: 'done'; summary: SessionSummary; canUndo: boolean }

export interface AnswerRequest {
  cardId: number
  input: string
  hintsUsed: number
  durationMs: number
  gaveUp: boolean
}

export interface AnswerResult {
  outcome: Outcome
  expected: string
  suggested: Grade
  intervals: Record<Grade, string>
}

export interface TodayOverview {
  dueReviews: number
  learning: number
  newAvailable: number
  reviewedToday: number
  newToday: number
  accuracyToday: number | null
  minutesToday: number
  streak: number
  totalWords: number
  readyWords: number
}

// ---------- statistics ----------

export interface DailyStat {
  date: string
  newCards: number
  learning: number
  review: number
  relearning: number
  firstAttempts: number
  firstCorrect: number
  minutes: number
}

export interface Dashboard {
  today: TodayOverview
  states: {
    new: number
    learning: number
    relearning: number
    young: number
    mature: number
    suspended: number
  }
  words: {
    total: number
    ready: number
    pending: number
    failed: number
    studied: number
    fullyMature: number
  }
  daily: DailyStat[]
  heatmap: { date: string; count: number }[]
  forecast: { date: string; count: number }[]
  stabilityBuckets: { label: string; count: number }[]
  retention: {
    target: number
    last30Total: number
    last30Passed: number
    avgRetrievability: number | null
  }
  hardest: { wordId: number; headword: string; lapses: number; reviews: number; accuracy: number }[]
  leeches: { wordId: number; headword: string; lapses: number }[]
  lists: ListSummary[]
  llm: {
    calls: number
    failed: number
    promptTokens: number
    completionTokens: number
    cacheHitTokens: number
  }
}

// ---------- data ----------

export interface BackupInfo {
  /** What restore() takes: a path on Windows, the file's name in the browser's storage. */
  file: string
  name: string
  size: number
  createdAt: number
}

/** A file for the person to keep; the interface offers it to save or share. */
export interface ExportFile {
  name: string
  mime: string
  data: string | Uint8Array
}
