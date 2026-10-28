import type {
  AnswerRequest,
  AnswerResult,
  BackupInfo,
  CommitRequest,
  CommitResult,
  CurveData,
  Dashboard,
  EnrichStatus,
  ExportFile,
  Grade,
  ImportFormat,
  ImportSource,
  ListSummary,
  LookupHistoryItem,
  LookupResult,
  ParsePreview,
  SensePatch,
  SessionSummary,
  SettingsPatch,
  SettingsView,
  StudyStep,
  TodayOverview,
  TriageItem,
  WordDetail,
  WordListPage,
  WordPatch,
  WordQuery
} from './types'

// The renderer's whole view of the main process. Every method becomes one IPC channel
// named "<namespace>.<method>"; the preload builds the proxies from API_METHODS and the
// main process registers one handler per entry, so the two sides cannot drift apart. The
// web app (src/web) builds the same proxies over messages to its worker.
export interface WordloomApi {
  settings: {
    get(): Promise<SettingsView>
    update(patch: SettingsPatch): Promise<SettingsView>
    setApiKey(key: string): Promise<SettingsView>
    testConnection(): Promise<{ ok: boolean; message: string }>
  }
  importer: {
    /** The renderer reads and decodes picked or dropped files itself (shared/decode.ts). */
    parse(sources: ImportSource[], format?: ImportFormat): Promise<ParsePreview>
    triage(words: string[]): Promise<TriageItem[]>
    commit(req: CommitRequest): Promise<CommitResult>
  }
  enrich: {
    status(): Promise<EnrichStatus>
    resume(): Promise<EnrichStatus>
    pause(): Promise<EnrichStatus>
    retryFailed(): Promise<EnrichStatus>
  }
  words: {
    list(query: WordQuery): Promise<WordListPage>
    get(id: number): Promise<WordDetail>
    update(id: number, patch: WordPatch): Promise<WordDetail>
    updateSense(senseId: number, patch: SensePatch): Promise<WordDetail>
    deleteSense(senseId: number): Promise<WordDetail>
    regenerate(id: number): Promise<WordDetail>
    remove(id: number): Promise<void>
    setSuspended(cardId: number, suspended: boolean): Promise<WordDetail>
    curve(cardId: number): Promise<CurveData>
  }
  lists: {
    all(): Promise<ListSummary[]>
    rename(id: number, name: string): Promise<void>
    remove(id: number): Promise<void>
  }
  lookup: {
    search(query: string, asTyped?: boolean): Promise<LookupResult>
    regenerate(headword: string): Promise<LookupResult>
    add(headword: string): Promise<LookupResult>
    history(): Promise<LookupHistoryItem[]>
    remove(id: number): Promise<void>
  }
  study: {
    overview(): Promise<TodayOverview>
    start(): Promise<StudyStep>
    current(): Promise<StudyStep | null>
    continueIntro(): Promise<StudyStep>
    markKnown(): Promise<StudyStep>
    answer(req: AnswerRequest): Promise<AnswerResult>
    rate(grade: Grade): Promise<StudyStep>
    undo(): Promise<StudyStep>
    finish(): Promise<SessionSummary | null>
  }
  stats: {
    dashboard(): Promise<Dashboard>
  }
  data: {
    openFolder(): Promise<void>
    backupNow(): Promise<BackupInfo>
    listBackups(): Promise<BackupInfo[]>
    restore(file: string): Promise<void>
    /** Replaces all data with a database file the person picked, e.g. one from another device. */
    restoreFile(bytes: Uint8Array): Promise<void>
    exportDatabase(): Promise<ExportFile>
    exportJson(): Promise<ExportFile>
    exportCsv(): Promise<ExportFile>
  }
}

export const API_METHODS = {
  settings: ['get', 'update', 'setApiKey', 'testConnection'],
  importer: ['parse', 'triage', 'commit'],
  enrich: ['status', 'resume', 'pause', 'retryFailed'],
  words: [
    'list',
    'get',
    'update',
    'updateSense',
    'deleteSense',
    'regenerate',
    'remove',
    'setSuspended',
    'curve'
  ],
  lists: ['all', 'rename', 'remove'],
  lookup: ['search', 'regenerate', 'add', 'history', 'remove'],
  study: [
    'overview',
    'start',
    'current',
    'continueIntro',
    'markKnown',
    'answer',
    'rate',
    'undo',
    'finish'
  ],
  stats: ['dashboard'],
  data: [
    'openFolder',
    'backupNow',
    'listBackups',
    'restore',
    'restoreFile',
    'exportDatabase',
    'exportJson',
    'exportCsv'
  ]
} as const satisfies { [K in keyof WordloomApi]: readonly (keyof WordloomApi[K])[] }

/** Pushed from the main process; each subscription returns its unsubscribe function. */
export interface WordloomEvents {
  onEnrichStatus(listener: (status: EnrichStatus) => void): () => void
  onTriageProgress(listener: (progress: { done: number; total: number }) => void): () => void
}

export const EVENT_CHANNELS = {
  enrichStatus: 'event.enrichStatus',
  triageProgress: 'event.triageProgress'
} as const

/** What a handler sends back, over IPC or from the web worker; the caller rethrows failures. */
export type IpcEnvelope = { ok: true; data: unknown } | { ok: false; error: string }
