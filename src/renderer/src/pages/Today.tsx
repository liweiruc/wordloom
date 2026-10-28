import {
  CircleAlert,
  FileUp,
  Flame,
  GraduationCap,
  KeyRound,
  PartyPopper,
  RefreshCw
} from 'lucide-react'
import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Empty, Notice, Page, Panel, StatTile } from '../components/ui'
import { api } from '../lib/api'
import { useApp } from '../lib/useApp'
import { formatDuration, percent } from '../lib/format'
import { useAsync } from '../lib/useAsync'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function GenerationNotice(): React.JSX.Element | null {
  const { enrich, refreshEnrich } = useApp()
  if (!enrich) return null
  if (!enrich.hasApiKey && enrich.pending > 0) {
    return (
      <Notice
        tone="warn"
        icon={<KeyRound size={18} />}
        action={
          <Link to="/settings">
            <Button size="sm">去设置</Button>
          </Link>
        }
      >
        有 {enrich.pending} 个词等待生成词条，需要先在设置里填写 DeepSeek API key。
      </Notice>
    )
  }
  if (enrich.paused && enrich.lastError) {
    return (
      <Notice
        tone="bad"
        icon={<CircleAlert size={18} />}
        action={
          <Button
            size="sm"
            onClick={async () => {
              await api.enrich.resume()
              await refreshEnrich()
            }}
          >
            继续生成
          </Button>
        }
      >
        词条生成已暂停：{enrich.lastError}
      </Notice>
    )
  }
  if (enrich.failed > 0) {
    return (
      <Notice
        tone="warn"
        icon={<CircleAlert size={18} />}
        action={
          <div className="flex gap-2">
            <Link to="/library?status=failed">
              <Button size="sm" variant="ghost">
                查看
              </Button>
            </Link>
            <Button
              size="sm"
              icon={<RefreshCw size={14} />}
              onClick={async () => {
                await api.enrich.retryFailed()
                await refreshEnrich()
              }}
            >
              全部重试
            </Button>
          </div>
        }
      >
        有 {enrich.failed} 个词生成失败。
      </Notice>
    )
  }
  return null
}

export default function Today(): React.JSX.Element {
  const navigate = useNavigate()
  const { enrich } = useApp()
  const overview = useAsync(() => api.study.overview(), [])
  const session = useAsync(() => api.study.current(), [])
  const { reload } = overview

  // Freshly generated words become new cards: keep the counts current while generation runs.
  useEffect(() => {
    reload()
  }, [enrich?.ready, reload])

  const o = overview.data
  const now = new Date()
  const resuming = session.data && session.data.kind !== 'done'
  const todo = o ? o.dueReviews + o.newAvailable + o.learning : 0

  return (
    <Page>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <div className="text-sm text-ink-2">
            {now.getMonth() + 1}月{now.getDate()}日 · 星期{WEEKDAYS[now.getDay()]}
          </div>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">复习</h1>
        </div>
        {o && o.streak > 0 && (
          <div className="flex items-center gap-1.5 rounded-lg bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent-text">
            <Flame size={16} />
            连续学习 {o.streak} 天
          </div>
        )}
      </div>

      <div className="flex flex-col gap-5">
        <GenerationNotice />

        {o && o.totalWords === 0 ? (
          <Panel>
            <Empty icon={<FileUp size={36} />} title="词库还是空的">
              先导入一个单词文件（比如词典导出的单词本 txt），Wordloom
              会提取单词并自动生成音标、释义和例句。
              <div className="mt-4">
                <Button
                  variant="primary"
                  onClick={() => navigate('/import')}
                  icon={<FileUp size={16} />}
                >
                  导入单词
                </Button>
              </div>
            </Empty>
          </Panel>
        ) : (
          <Panel>
            <div className="flex items-center gap-8">
              <div className="grid flex-1 grid-cols-3 gap-6">
                <div>
                  <div className="text-xs text-ink-2">待复习</div>
                  <div className="mt-1 text-4xl font-semibold">{o?.dueReviews ?? '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-2">新卡</div>
                  <div className="mt-1 text-4xl font-semibold">{o?.newAvailable ?? '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-2">学习中</div>
                  <div className="mt-1 text-4xl font-semibold">{o?.learning ?? '—'}</div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {todo > 0 || resuming ? (
                  <Button
                    variant="primary"
                    size="lg"
                    icon={<GraduationCap size={18} />}
                    onClick={() => navigate('/study')}
                  >
                    {resuming ? '继续学习' : '开始学习'}
                  </Button>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-ink-2">
                    <PartyPopper size={18} />
                    {o && o.readyWords === 0 ? '词条还在生成中，稍等一会儿' : '今天的任务都完成了'}
                  </div>
                )}
              </div>
            </div>
          </Panel>
        )}

        {o && o.totalWords > 0 && (
          <div className="grid grid-cols-4 gap-4">
            <StatTile
              label="今天已复习"
              value={o.reviewedToday}
              sub={`其中新学 ${o.newToday} 张`}
            />
            <StatTile label="今天首答正确率" value={percent(o.accuracyToday)} />
            <StatTile label="今天学习时长" value={formatDuration(o.minutesToday * 60_000)} />
            <StatTile label="词库" value={o.totalWords} sub={`已生成 ${o.readyWords} 个`} />
          </div>
        )}
      </div>
    </Page>
  )
}
