import { BookOpen, RefreshCw, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { WordListItem, WordQuery, WordStatus } from '../../../shared/types'
import {
  Badge,
  Button,
  Empty,
  Page,
  PageHeader,
  Panel,
  Select,
  Spinner,
  TextInput
} from '../components/ui'
import { api } from '../lib/api'
import { useApp } from '../lib/useApp'
import { formatDue } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { useDebounced } from '../lib/useDebounced'

const PAGE = 100
// A search the 查词 page could look up when the library has nothing for it.
const LOOKUPABLE = /^[A-Za-z][A-Za-z' .-]*$/

function StatusBadge({ word }: { word: WordListItem }): React.JSX.Element | null {
  if (word.status === 'pending') return <Badge>等待生成</Badge>
  if (word.status === 'enriching') return <Badge tone="info">生成中</Badge>
  if (word.status === 'failed') {
    return (
      <Badge tone="bad" title={word.error ?? undefined}>
        生成失败
      </Badge>
    )
  }
  return null
}

function Progress({ word }: { word: WordListItem }): React.JSX.Element {
  if (word.senseCount === 0) return <span className="text-ink-3">—</span>
  return (
    <div
      className="flex items-center gap-1"
      title={`已学 ${word.reviewedCards} / 已掌握 ${word.matureCards} / 共 ${word.senseCount} 个义项`}
    >
      {Array.from({ length: word.senseCount }, (_, i) => (
        <span
          key={i}
          className="inline-block h-2 w-4 rounded-sm"
          style={{
            background:
              i < word.matureCards
                ? 'var(--ord-4)'
                : i < word.reviewedCards
                  ? 'var(--ord-2)'
                  : 'var(--surface-3)'
          }}
        />
      ))}
    </div>
  )
}

export default function Library(): React.JSX.Element {
  const navigate = useNavigate()
  const { enrich, refreshEnrich } = useApp()
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as WordStatus | null) ?? 'all'
  const listParam = params.get('list')
  const listId = listParam ? Number(listParam) : null
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<NonNullable<WordQuery['sort']>>('recent')
  const [limit, setLimit] = useState(PAGE)
  const query = useDebounced(search, 200)

  const lists = useAsync(() => api.lists.all(), [])
  const page = useAsync(
    () => api.words.list({ search: query, status, listId, sort, limit }),
    [query, status, listId, sort, limit]
  )
  const { reload } = page

  useEffect(() => {
    reload()
  }, [enrich?.ready, enrich?.failed, reload])

  const setParam = (key: string, value: string | null): void => {
    const next = new URLSearchParams(params)
    if (value === null || value === 'all') next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
    setLimit(PAGE)
  }

  const data = page.data
  return (
    <Page wide>
      <PageHeader
        title="词库"
        description={data ? `共 ${data.total} 个词` : undefined}
        actions={
          enrich && enrich.failed > 0 ? (
            <Button
              icon={<RefreshCw size={15} />}
              onClick={async () => {
                await api.enrich.retryFailed()
                await refreshEnrich()
              }}
            >
              重试 {enrich.failed} 个失败的词
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索单词或释义（中英文都可以）"
            className="pl-9"
          />
        </div>
        <Select
          value={listId ?? ''}
          onChange={(e) => setParam('list', e.target.value || null)}
          className="!w-48"
        >
          <option value="">全部词表</option>
          {lists.data?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}（{l.words}）
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => setParam('status', e.target.value)}
          className="!w-36"
        >
          <option value="all">全部状态</option>
          <option value="ready">已生成</option>
          <option value="pending">等待生成</option>
          <option value="enriching">生成中</option>
          <option value="failed">生成失败</option>
        </Select>
        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value as NonNullable<WordQuery['sort']>)}
          className="!w-36"
        >
          <option value="recent">最近导入</option>
          <option value="alpha">字母顺序</option>
          <option value="due">下次复习</option>
        </Select>
      </div>

      <Panel padded={false}>
        {!data ? (
          <div className="p-6">
            {page.error ? (
              <span className="text-bad-ink">{page.error}</span>
            ) : (
              <Spinner label="加载中…" />
            )}
          </div>
        ) : data.items.length === 0 ? (
          <Empty
            icon={<BookOpen size={32} />}
            title={query || status !== 'all' || listId ? '没有符合条件的词' : '词库还是空的'}
          >
            {!query && status === 'all' && !listId && (
              <Link to="/import" className="text-accent-text hover:underline">
                去导入单词
              </Link>
            )}
            {LOOKUPABLE.test(query.trim()) && (
              <Link
                to={`/lookup?q=${encodeURIComponent(query.trim())}`}
                className="text-accent-text hover:underline"
              >
                用 DeepSeek 查「{query.trim()}」
              </Link>
            )}
          </Empty>
        ) : (
          <table
            className={`w-full text-sm transition-opacity ${page.loading ? 'opacity-60' : ''}`}
          >
            <thead className="border-b border-[var(--border)] text-left text-xs text-ink-2">
              <tr>
                <th className="px-5 py-2.5 font-medium">单词</th>
                <th className="px-3 py-2.5 font-medium">美音</th>
                <th className="px-3 py-2.5 font-medium">首个释义</th>
                <th className="px-3 py-2.5 font-medium">义项进度</th>
                <th className="px-3 py-2.5 font-medium">下次复习</th>
                <th className="px-5 py-2.5 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((w) => (
                <tr
                  key={w.id}
                  onClick={() => navigate(`/words/${w.id}`)}
                  className="cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-surface-2"
                >
                  <td className="px-5 py-2 font-medium text-ink">{w.headword}</td>
                  <td className="px-3 py-2 text-ink-2">{w.ipaUs}</td>
                  <td
                    className="max-w-[380px] truncate px-3 py-2 text-ink-2"
                    title={w.firstDef ?? undefined}
                  >
                    {w.firstDef ??
                      (w.status === 'failed' ? (
                        <span className="text-bad-ink">{w.error}</span>
                      ) : (
                        ''
                      ))}
                  </td>
                  <td className="px-3 py-2">
                    <Progress word={w} />
                  </td>
                  <td className="px-3 py-2 text-ink-2 tabular">
                    {w.nextDue ? formatDue(w.nextDue) : ''}
                  </td>
                  <td className="px-5 py-2">
                    <StatusBadge word={w} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {data && data.items.length < data.total && (
        <div className="mt-4 flex justify-center">
          <Button onClick={() => setLimit((n) => n + PAGE)} busy={page.loading}>
            再加载 {Math.min(PAGE, data.total - data.items.length)} 个
          </Button>
        </div>
      )}
    </Page>
  )
}
