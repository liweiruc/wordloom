import { BookmarkPlus, BookSearch, KeyRound, RefreshCw, Sparkles, Trash } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { normKey } from '../../../shared/text'
import { DEFAULT_LIST_NAME, REGISTER_LABEL, type LookupResult } from '../../../shared/types'
import { SenseBody } from '../components/SenseBody'
import { SpeakButton } from '../components/SpeakButton'
import {
  Badge,
  Button,
  Empty,
  Notice,
  Page,
  PageHeader,
  Panel,
  Spinner,
  TextInput
} from '../components/ui'
import { api, errorText } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { useApp } from '../lib/useApp'
import { useAsync } from '../lib/useAsync'

function SourceBadge({ result }: { result: LookupResult }): React.JSX.Element {
  if (result.inDefaultList) return <Badge tone="accent">已在{DEFAULT_LIST_NAME}</Badge>
  if (result.source === 'library') return <Badge tone="good">已在词库</Badge>
  if (result.source === 'saved') return <Badge title="上次查这个词时保存的词条">查过</Badge>
  return <Badge tone="info">新生成</Badge>
}

function Entry({
  result,
  adding,
  onAdd,
  onRegenerate,
  onAsTyped
}: {
  result: LookupResult
  adding: boolean
  onAdd(): void
  onRegenerate(): void
  onAsTyped(input: string): void
}): React.JSX.Element {
  const { correction } = result
  return (
    <div className="flex flex-col gap-4">
      {correction && (
        <Notice
          tone="info"
          icon={<Sparkles size={16} />}
          action={
            <Button size="sm" variant="ghost" onClick={() => onAsTyped(correction.input)}>
              按原样查「{correction.input}」
            </Button>
          }
        >
          已按「{result.headword}」查
          {correction.note
            ? `。「${correction.input}」：${correction.note}`
            : `（输入的是「${correction.input}」）`}
        </Notice>
      )}
      <Panel>
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-semibold tracking-tight">{result.headword}</h2>
              <SpeakButton text={result.headword} size={20} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-4 text-[15px] text-ink-2">
              {result.ipaUk && <span>英 {result.ipaUk}</span>}
              {result.ipaUs && <span>美 {result.ipaUs}</span>}
              {result.variants.length > 0 && (
                <span className="text-sm">也写作 {result.variants.join('、')}</span>
              )}
            </div>
            <div className="mt-3">
              <SourceBadge result={result} />
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {result.source !== 'library' && (
              <Button
                icon={<RefreshCw size={15} />}
                onClick={onRegenerate}
                title="对这个词条不满意时，让 DeepSeek 重新生成"
              >
                重新生成
              </Button>
            )}
            {result.wordId !== null && (
              <Link to={`/words/${result.wordId}`}>
                <Button>查看详情</Button>
              </Link>
            )}
            {!result.inDefaultList && (
              <Button
                variant="primary"
                icon={<BookmarkPlus size={15} />}
                busy={adding}
                onClick={onAdd}
              >
                加入{DEFAULT_LIST_NAME}
              </Button>
            )}
          </div>
        </div>

        {result.status === 'failed' ? (
          <div className="mt-5">
            <Notice tone="bad">词库里有这个词，但词条生成失败了，可以在详情里重新生成。</Notice>
          </div>
        ) : result.status !== null && result.status !== 'ready' ? (
          <div className="mt-5">
            <Notice tone="info" icon={<Spinner />}>
              词库里有这个词，词条还在排队生成。
            </Notice>
          </div>
        ) : null}

        {result.senses.map((s, i) => (
          <div key={i} className="mt-5 border-t border-[var(--border)] pt-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-3">#{i + 1}</span>
              <Badge>{s.pos}</Badge>
              {s.register !== 'neutral' && <Badge tone="info">{REGISTER_LABEL[s.register]}</Badge>}
            </div>
            <SenseBody
              defEn={s.defEn}
              defZh={s.defZh}
              synonyms={s.synonyms}
              example={s.exampleEn ? { en: s.exampleEn, zh: s.exampleZh, cloze: s.cloze } : null}
            />
          </div>
        ))}
      </Panel>
    </div>
  )
}

export default function Lookup(): React.JSX.Element {
  const { settings, toast } = useApp()
  const [params] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [pending, setPending] = useState<string | null>(null)
  const [result, setResult] = useState<LookupResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const history = useAsync(() => api.lookup.history(), [])
  const { reload } = history

  const show = async (word: string, load: () => Promise<LookupResult>): Promise<void> => {
    setPending(word)
    setError(null)
    try {
      setResult(await load())
    } catch (err) {
      setResult(null)
      setError(errorText(err))
    } finally {
      setPending(null)
      reload()
      // Ready for the next word: typing replaces this one.
      input.current?.focus()
      input.current?.select()
    }
  }

  const search = (word: string, asTyped = false): Promise<void> => {
    setQuery(word)
    return show(word, () => api.lookup.search(word, asTyped))
  }

  const regenerate = (headword: string): Promise<void> => {
    const correction = result?.correction ?? null
    return show(headword, async () => ({ ...(await api.lookup.regenerate(headword)), correction }))
  }

  const add = async (headword: string): Promise<void> => {
    setAdding(true)
    try {
      const added = await api.lookup.add(headword)
      setResult((shown) =>
        shown && normKey(shown.headword) === normKey(added.headword)
          ? { ...added, correction: shown.correction }
          : shown
      )
      toast(`已加入「${DEFAULT_LIST_NAME}」`)
      reload()
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setAdding(false)
    }
  }

  const forget = async (id: number): Promise<void> => {
    try {
      await api.lookup.remove(id)
      reload()
    } catch (err) {
      toast(errorText(err), 'error')
    }
  }

  // The library's search links here with the word to look up. Once only: StrictMode runs
  // effects twice in development, and a lookup can cost a request.
  const opened = useRef(false)
  useEffect(() => {
    const word = params.get('q')
    if (opened.current || !word) return
    opened.current = true
    void search(word)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Page>
      <PageHeader
        title="查词"
        description="查一个新词：词条和词库里的词一样由 DeepSeek 生成和检查；加入生词本后直接用这份词条复习，不会重新生成。"
      />
      <form
        className="mb-5 flex items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (query.trim() && pending === null) void search(query.trim())
        }}
      >
        <div className="relative flex-1">
          <BookSearch size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
          <TextInput
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入英文单词或短语，按 Enter 查"
            aria-label="要查的词"
            autoFocus
            autoComplete="off"
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="primary" busy={pending !== null} disabled={!query.trim()}>
          查词
        </Button>
      </form>

      {settings && !settings.hasApiKey && (
        <div className="mb-5">
          <Notice
            tone="warn"
            icon={<KeyRound size={18} />}
            action={
              <Link to="/settings">
                <Button size="sm">去设置</Button>
              </Link>
            }
          >
            查新词需要 DeepSeek API key；词库里的词和查过的词不用。
          </Notice>
        </div>
      )}

      {pending !== null && (
        // Shown only if the lookup takes a while: a saved entry comes back at once.
        <div className="animate-fade-in mb-4" style={{ animationDelay: '250ms' }}>
          <Spinner label={`正在查「${pending}」…新词要先生成词条，可能需要十几秒。`} />
        </div>
      )}
      {error && pending === null && (
        <div className="mb-6">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
      {result && (
        <div
          className={`mb-6 transition-opacity ${pending !== null ? 'pointer-events-none opacity-50' : ''}`}
        >
          <Entry
            result={result}
            adding={adding}
            onAdd={() => void add(result.headword)}
            onRegenerate={() => void regenerate(result.headword)}
            onAsTyped={(word) => void search(word, true)}
          />
        </div>
      )}

      <Panel
        title="最近查过"
        subtitle="点一下重新打开：用保存下来的词条，不会再调用 DeepSeek"
        padded={false}
      >
        {!history.data ? (
          <div className="px-5 pt-3 pb-5">
            {history.error ? <span className="text-bad-ink">{history.error}</span> : <Spinner />}
          </div>
        ) : history.data.length === 0 ? (
          <Empty icon={<BookSearch size={28} />} title="还没有查过词" />
        ) : (
          <ul className="mt-3">
            {history.data.map((h) => (
              <li
                key={h.id}
                onClick={() => void search(h.headword)}
                className="flex cursor-pointer items-center gap-3 border-t border-[var(--border)] px-5 py-2 text-sm hover:bg-surface-2"
              >
                <span className="font-medium text-ink">{h.headword}</span>
                <span className="min-w-0 flex-1 truncate text-ink-2">{h.gloss}</span>
                {h.inDefaultList ? (
                  <Badge tone="accent">{DEFAULT_LIST_NAME}</Badge>
                ) : h.wordId !== null ? (
                  <Badge tone="good">词库</Badge>
                ) : null}
                <span className="text-xs text-ink-3 tabular">{formatDateTime(h.lookedUpAt)}</span>
                <div className="flex w-14 justify-end gap-0.5">
                  {!h.inDefaultList && (
                    <button
                      type="button"
                      title={`加入${DEFAULT_LIST_NAME}`}
                      aria-label={`把 ${h.headword} 加入${DEFAULT_LIST_NAME}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        void add(h.headword)
                      }}
                      className="cursor-pointer rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink"
                    >
                      <BookmarkPlus size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    title="从记录中删除"
                    aria-label={`从记录中删除 ${h.headword}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      void forget(h.id)
                    }}
                    className="cursor-pointer rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-bad-ink"
                  >
                    <Trash size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Page>
  )
}
