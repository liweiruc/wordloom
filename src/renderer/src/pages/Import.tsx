import { CircleCheck, FileUp, FolderOpen, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { decodeText } from '../../../shared/decode'
import { suggestedHeadword } from '../../../shared/triage'
import {
  DEFAULT_LIST_NAME,
  type CommitItem,
  type CommitResult,
  type FileEntry,
  type ImportFormat,
  type ImportSource,
  type ParsePreview,
  type TextFormat,
  type TriageItem,
  type TriageKind
} from '../../../shared/types'
import {
  Badge,
  Button,
  Notice,
  Page,
  PageHeader,
  Panel,
  Select,
  Spinner,
  TextInput
} from '../components/ui'
import { api, errorText, events } from '../lib/api'
import { useApp } from '../lib/useApp'

const FORMAT_LABEL: Record<ImportFormat, string> = {
  dictExport: '词典单词本导出',
  lineList: '逐行词表',
  freeText: '文章 / 自由文本',
  entries: '词条文件（JSON）'
}

const FORMAT_HINT: Record<ImportFormat, string> = {
  dictExport: '只取编号行里的单词，下面的释义行和日期行都忽略',
  lineList: '取每一行开头的英文单词或短语',
  freeText: '提取文中所有单词，还原成原形，去掉常见虚词',
  entries: '写好的词条通过检查后直接使用，不再生成'
}

const TEXT_FORMATS: TextFormat[] = ['dictExport', 'lineList', 'freeText']

const KIND_BADGE: Record<
  TriageKind,
  { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' | 'info' }
> = {
  ok: { label: '', tone: 'neutral' },
  inflection: { label: '词形变化', tone: 'warn' },
  misspelling: { label: '拼写错误', tone: 'bad' },
  variant: { label: '写法变体', tone: 'info' },
  proper_noun: { label: '专有名词', tone: 'neutral' },
  not_english: { label: '不是英文', tone: 'bad' }
}

interface Row {
  norm: string
  original: string
  final: string
  include: boolean
  occurrences: number
  existing: boolean
  /** In the library with an entry of its own, which it keeps. */
  libraryEntry: boolean
  triage?: TriageItem
  fileEntry: FileEntry | null
}

type Filter = 'all' | 'changed' | 'existing' | 'excluded' | 'problems'

const lower = (s: string): string => s.trim().toLowerCase()

// A word that brings its entry from an entries file is saved with it. It keeps the headword the
// entry was written for, so the clean-up leaves it alone and it cannot be renamed.
const usesEntry = (r: Row): boolean => !r.libraryEntry && Boolean(r.fileEntry?.entry)

const hasProblems = (r: Row): boolean => !r.libraryEntry && Boolean(r.fileEntry?.problems.length)

// The source name of text pasted in. It has no file to name a list after, so its words go
// to 生词本, next to the looked-up ones.
const PASTED = '粘贴的文本'

function defaultListName(sources: ImportSource[]): string {
  const first = sources[0]?.name ?? ''
  if (first === PASTED) return DEFAULT_LIST_NAME
  return first.replace(/\.[^.]+$/, '') || `导入 ${new Date().toLocaleDateString()}`
}

const TEXT_FILE = /\.(txt|md|csv|tsv|text|json)$/i

// Picked and dropped files are read here, where the browser hands them over, and decoded
// before they go to the main process (or the web app's worker) as text.
async function readFiles(files: File[]): Promise<ImportSource[]> {
  const usable = files.filter((f) => TEXT_FILE.test(f.name))
  if (usable.length === 0) throw new Error('只支持 .txt / .md / .csv / .json 文本文件。')
  return Promise.all(
    usable.map(async (f) => ({
      name: f.name,
      ...decodeText(new Uint8Array(await f.arrayBuffer()))
    }))
  )
}

// Words saved with the file's entries can be studied already; this is about the rest.
function generationNote(result: CommitResult, hasApiKey: boolean): string {
  const rest = result.filled > 0 ? `其余 ${result.queued} 个词的` : ''
  return hasApiKey
    ? `${rest}词条正在后台生成，左下角可以看进度；生成好的词马上就能开始学。`
    : `填写 DeepSeek API key 后开始生成${rest}词条。`
}

function EntryCell({ row }: { row: Row }): React.JSX.Element | null {
  const file = row.fileEntry
  if (row.libraryEntry) {
    return file ? <span className="text-xs text-ink-3">用词库里的词条</span> : null
  }
  if (!file) return row.existing ? null : <span className="text-xs text-ink-3">将生成</span>
  const kept = file.entry?.senses.length ?? 0
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        {file.entry ? (
          <>
            <Badge tone={file.problems.length > 0 ? 'warn' : 'good'}>
              {kept < file.given ? `保留 ${kept}/${file.given} 个义项` : `${kept} 个义项`}
            </Badge>
            <span className="text-xs text-ink-2">{file.entry.senses[0].defZh}</span>
          </>
        ) : (
          <Badge tone="bad">{row.existing ? '词条没有通过检查' : '词条没有通过检查，将生成'}</Badge>
        )}
      </div>
      {file.problems.length > 0 && (
        <ul className="text-xs text-warn-ink">
          {file.problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function ImportPage(): React.JSX.Element {
  const { settings, toast, refreshEnrich } = useApp()
  const [sources, setSources] = useState<ImportSource[]>([])
  const [preview, setPreview] = useState<ParsePreview | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [listName, setListName] = useState('')
  const [paste, setPaste] = useState('')
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [triage, setTriage] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [filter, setFilter] = useState<Filter>('all')
  const [committing, setCommitting] = useState(false)
  const [result, setResult] = useState<CommitResult | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const canTriage = Boolean(settings?.hasApiKey)

  const runTriage = async (words: string[]): Promise<void> => {
    setTriage('running')
    setProgress({ done: 0, total: 0 })
    const off = events.onTriageProgress(setProgress)
    try {
      const items = await api.importer.triage(words)
      const byInput = new Map(items.map((t) => [lower(t.input), t]))
      setRows((list) =>
        list.map((row) => {
          const t = byInput.get(lower(row.original))
          if (!t) return row
          return {
            ...row,
            triage: t,
            final: suggestedHeadword(row.original, t),
            include: t.kind !== 'not_english'
          }
        })
      )
      setTriage('done')
    } catch (err) {
      setTriage('error')
      toast(`智能整理失败：${errorText(err)}`, 'error')
    } finally {
      off()
    }
  }

  const load = async (srcs: ImportSource[], format?: TextFormat): Promise<void> => {
    if (srcs.length === 0) return
    setLoading(true)
    try {
      const p = await api.importer.parse(srcs, format)
      const next: Row[] = p.candidates.map((c) => ({
        norm: c.norm,
        original: c.headword,
        final: c.headword,
        include: true,
        occurrences: c.occurrences,
        existing: c.existingWordId !== null,
        libraryEntry: c.existingStatus === 'ready',
        fileEntry: c.fileEntry
      }))
      setSources(srcs)
      setPreview(p)
      setResult(null)
      setFilter('all')
      setRows(next)
      if (!format) setListName(defaultListName(srcs))
      setTriage('idle')
      const loose = next.filter((r) => !usesEntry(r))
      if (settings?.settings.llm.smartCleanup && canTriage && loose.length > 0) {
        void runTriage(loose.map((r) => r.original))
      }
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    try {
      await load(await readFiles(files))
    } catch (err) {
      toast(errorText(err), 'error')
    }
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragging(false)
    await loadFiles([...e.dataTransfer.files])
  }

  // One item per headword. Where rows merge into one, a row that brings an entry wins over one
  // that does not, so merging never loses an entry.
  const items = useMemo(() => {
    const byKey = new Map<string, CommitItem>()
    for (const r of rows) {
      const headword = r.final.trim()
      if (!r.include || !headword) continue
      const entry = usesEntry(r) ? (r.fileEntry?.entry ?? undefined) : undefined
      const seen = byKey.get(lower(headword))
      if (seen && (seen.entry || !entry)) continue
      byKey.set(lower(headword), {
        headword,
        kind: r.triage?.kind === 'proper_noun' ? 'proper_noun' : undefined,
        entry
      })
    }
    return [...byKey.values()]
  }, [rows])

  const visible = rows.filter((r) => {
    if (filter === 'changed') return r.final !== r.original || (r.triage && r.triage.kind !== 'ok')
    if (filter === 'existing') return r.existing
    if (filter === 'excluded') return !r.include
    if (filter === 'problems') return hasProblems(r)
    return true
  })

  const update = (norm: string, patch: Partial<Row>): void =>
    setRows((list) => list.map((r) => (r.norm === norm ? { ...r, ...patch } : r)))

  const commit = async (): Promise<void> => {
    setCommitting(true)
    try {
      const res = await api.importer.commit({
        listName,
        sourceFile: sources.map((s) => s.name).join(', ') || null,
        items
      })
      setResult(res)
      await refreshEnrich()
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setCommitting(false)
    }
  }

  const reset = (): void => {
    setPreview(null)
    setRows([])
    setSources([])
    setResult(null)
    setPaste('')
  }

  if (result) {
    return (
      <Page>
        <PageHeader title="导入" />
        <Panel>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CircleCheck size={40} className="text-good-ink" />
            <div className="text-xl font-semibold">已导入到「{listName}」</div>
            <div className="text-sm text-ink-2">
              新增 {result.created} 个词
              {result.linked > 0 && `，${result.linked} 个已在词库中的词加入了这个词表`}。
              {result.filled > 0 && `${result.filled} 个词用了文件里的词条，现在就能学。`}
              {result.queued > 0 && generationNote(result, Boolean(settings?.hasApiKey))}
            </div>
            <div className="mt-4 flex gap-3">
              <Button onClick={reset}>继续导入</Button>
              <Link to={`/library?list=${result.listId}`}>
                <Button>查看词表</Button>
              </Link>
              <Link to="/review">
                <Button variant="primary">回到复习</Button>
              </Link>
            </div>
          </div>
        </Panel>
      </Page>
    )
  }

  if (!preview) {
    return (
      <Page>
        <PageHeader
          title="导入"
          description="从单词文件或一段文字里提取单词，由 Wordloom 生成词条；写好词条的 JSON 文件可以直接导入，不用再生成。"
        />
        <div className="flex flex-col gap-5">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition ${
              dragging ? 'border-accent bg-accent-soft' : 'border-[var(--border)] bg-surface'
            }`}
          >
            <FileUp size={36} className="text-ink-3" />
            <div className="text-base font-medium">把 .txt / .md / .csv / .json 文件拖到这里</div>
            <div className="text-sm text-ink-2">
              支持词典导出的单词本、每行一个词的列表、一篇文章，以及写好词条的 JSON
              文件；编码会自动识别（UTF-8、UTF-16、GBK）。
            </div>
            <Button
              variant="primary"
              icon={<FolderOpen size={16} />}
              onClick={() => fileInput.current?.click()}
              busy={loading}
              className="mt-2"
            >
              选择文件
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".txt,.md,.csv,.tsv,.text,.json,text/plain,text/csv,text/markdown,application/json"
              className="hidden"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                // Cleared so that picking the same file again still counts as a change.
                e.target.value = ''
                void loadFiles(files)
              }}
            />
          </div>
          <Panel title="或者粘贴文本">
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={7}
              placeholder={
                '每行一个单词，或者直接粘贴一段英文、写好词条的 JSON\nabandon\ngive up\nwrinkle  [ˈrɪŋk(ə)l]  n. 皱纹'
              }
              className="w-full resize-y rounded-lg border border-[var(--border)] bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent"
            />
            <div className="mt-3 flex justify-end">
              <Button
                disabled={!paste.trim()}
                busy={loading}
                onClick={() => load([{ name: PASTED, text: paste, encoding: 'UTF-8' }])}
              >
                解析
              </Button>
            </div>
          </Panel>
        </div>
      </Page>
    )
  }

  const included = rows.filter((r) => r.include).length
  const loose = rows.filter((r) => !usesEntry(r))
  const hasEntries = rows.some((r) => r.fileEntry)
  const withEntry = items.filter((i) => i.entry).length
  const counts: Record<Filter, number> = {
    all: rows.length,
    changed: rows.filter((r) => r.final !== r.original || (r.triage && r.triage.kind !== 'ok'))
      .length,
    existing: rows.filter((r) => r.existing).length,
    excluded: rows.filter((r) => !r.include).length,
    problems: rows.filter(hasProblems).length
  }

  return (
    <Page wide>
      <PageHeader
        title="导入预览"
        description={preview.sources
          .map(
            (s) =>
              `${s.name}（${s.format === 'entries' ? '词条文件，' : ''}${s.encoding}，${s.lines} 行）`
          )
          .join('；')}
        actions={
          <Button variant="ghost" icon={<RotateCcw size={15} />} onClick={reset}>
            重新选择
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-[1fr_auto] items-end gap-4">
        <div className="flex items-end gap-4">
          <label className="w-[300px] text-xs text-ink-2">
            识别格式{preview.format !== preview.detected && '（已手动更改）'}
            {preview.format === 'entries' ? (
              <div className="mt-1 flex h-9 items-center text-sm text-ink">
                {FORMAT_LABEL.entries}
              </div>
            ) : (
              <Select
                value={preview.format}
                onChange={(e) => load(sources, e.target.value as TextFormat)}
                className="mt-1"
              >
                {TEXT_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABEL[f]}
                    {f === preview.detected ? ' · 自动识别' : ''}
                  </option>
                ))}
              </Select>
            )}
            <span className="mt-1 block h-4 truncate">{FORMAT_HINT[preview.format]}</span>
          </label>
          <label className="w-[260px] text-xs text-ink-2">
            词表名称
            <TextInput
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              className="mt-1"
            />
            <span className="mt-1 block h-4">已有同名词表时，会加入那个词表</span>
          </label>
        </div>
        <div>
          {loose.length > 0 &&
            (triage === 'running' ? (
              <Spinner
                label={`智能整理中… ${progress.total ? `${progress.done}/${progress.total} 组` : ''}`}
              />
            ) : (
              <Button
                icon={<Sparkles size={15} />}
                disabled={!canTriage}
                title={
                  canTriage
                    ? '用 DeepSeek 找出词形变化、拼写错误和专有名词'
                    : '需要先在设置里填写 DeepSeek API key'
                }
                onClick={() => runTriage(loose.map((r) => r.original))}
              >
                {triage === 'done' ? '重新整理' : '智能整理'}
              </Button>
            ))}
        </div>
      </div>

      {triage === 'done' && counts.changed > 0 && (
        <div className="mb-4">
          <Notice tone="info" icon={<Sparkles size={16} />}>
            整理建议已经填好：复数、过去式等词形会合并到原形，拼写错误已改正。可以在「有改动」里逐个检查，也可以直接修改要导入的写法。
          </Notice>
        </div>
      )}

      {preview.skipped.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn" icon={<TriangleAlert size={16} className="shrink-0" />}>
            有 {preview.skipped.length} 项不能导入：{preview.skipped.slice(0, 3).join('；')}
            {preview.skipped.length > 3 && '……'}
          </Notice>
        </div>
      )}

      <Panel padded={false}>
        <div className="flex items-center gap-1 border-b border-[var(--border)] px-4 py-2 text-xs">
          {(
            [
              ['all', '全部'],
              ['changed', '有改动'],
              ['existing', '已在词库'],
              ['excluded', '不导入'],
              ...(hasEntries ? [['problems', '有问题']] : [])
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`cursor-pointer rounded-md px-2.5 py-1 ${filter === key ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:text-ink'}`}
            >
              {label} {counts[key]}
            </button>
          ))}
        </div>
        <div className="max-h-[calc(100vh-360px)] min-h-[240px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface text-left text-xs text-ink-2 shadow-[0_1px_0_var(--border)]">
              <tr>
                <th className="w-10 px-4 py-2">
                  <input
                    type="checkbox"
                    aria-label="全选"
                    checked={visible.length > 0 && visible.every((r) => r.include)}
                    onChange={(e) => {
                      const keys = new Set(visible.map((r) => r.norm))
                      setRows((list) =>
                        list.map((r) =>
                          keys.has(r.norm) ? { ...r, include: e.target.checked } : r
                        )
                      )
                    }}
                  />
                </th>
                <th className="px-3 py-2 font-medium">原词</th>
                <th className="w-[240px] px-3 py-2 font-medium">导入为</th>
                {hasEntries && <th className="px-3 py-2 font-medium">词条</th>}
                <th className="px-3 py-2 font-medium">整理结果</th>
                <th className="px-4 py-2 text-right font-medium whitespace-nowrap">次数</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const badge = r.triage ? KIND_BADGE[r.triage.kind] : null
                const merged =
                  r.include &&
                  lower(r.final) !== lower(r.original) &&
                  rows.some((o) => o !== r && o.include && lower(o.final) === lower(r.final))
                return (
                  <tr
                    key={r.norm}
                    className={`border-t border-[var(--border)] ${r.include ? '' : 'opacity-50'}`}
                  >
                    <td className="px-4 py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`导入 ${r.original}`}
                        checked={r.include}
                        onChange={(e) => update(r.norm, { include: e.target.checked })}
                      />
                    </td>
                    <td className="px-3 py-1.5 font-medium">{r.original}</td>
                    <td className="px-3 py-1.5">
                      {usesEntry(r) ? (
                        <div className="flex h-7 items-center px-2">{r.final}</div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <input
                            value={r.final}
                            onChange={(e) => update(r.norm, { final: e.target.value })}
                            className={`h-7 w-full rounded-md border border-transparent bg-transparent px-2 outline-none hover:border-[var(--border)] focus:border-accent focus:bg-surface ${
                              r.final !== r.original ? 'font-medium text-accent-text' : ''
                            }`}
                          />
                          {r.final !== r.original && (
                            <button
                              type="button"
                              title="还原为原词"
                              onClick={() => update(r.norm, { final: r.original })}
                              className="cursor-pointer rounded p-1 text-ink-3 hover:text-ink"
                            >
                              <RotateCcw size={12} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    {hasEntries && (
                      <td className="px-3 py-1.5">
                        <EntryCell row={r} />
                      </td>
                    )}
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {r.existing && <Badge tone="good">已在词库</Badge>}
                        {badge?.label && <Badge tone={badge.tone}>{badge.label}</Badge>}
                        {r.triage?.kind === 'inflection' && r.triage.keepSeparate && (
                          <Badge tone="info">有独立含义，保留</Badge>
                        )}
                        {merged && <Badge>合并</Badge>}
                        {r.triage?.note && (
                          <span className="text-xs text-ink-2">{r.triage.note}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-1.5 text-right text-ink-3 tabular">
                      {r.occurrences > 1 ? r.occurrences : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm text-ink-2">
          {rows.length} 个候选，勾选 {included} 个，合并后实际导入{' '}
          <span className="font-semibold text-ink">{items.length}</span> 个词
          {withEntry > 0 && `，其中 ${withEntry} 个带词条，导入后就能学`}
        </div>
        <Button
          variant="primary"
          size="lg"
          disabled={items.length === 0 || triage === 'running'}
          busy={committing}
          onClick={commit}
        >
          导入 {items.length} 个词
        </Button>
      </div>
    </Page>
  )
}
